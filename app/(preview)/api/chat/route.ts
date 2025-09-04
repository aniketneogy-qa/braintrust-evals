import { openai } from "@ai-sdk/openai";
import { streamText, ToolInvocation } from "ai";
import { getWeather, getFahrenheit } from "@/components/tools";
// Centralized Braintrust utilities (logger, masking, helpers)
import { wrapAISDKModel, traced, currentSpan, logger } from "@/lib/braintrust";
import { weatherLLMJudgeScore, generalLLMJudgeScore, contentAccuracyScore } from "@/lib/scorers";

// Any time this model is called, the input and output will be logged to Braintrust.
const model = wrapAISDKModel(openai("gpt-4o"));

interface Message {
  role: "user" | "assistant";
  content: string;
  toolInvocations?: ToolInvocation[];
}

export async function POST(request: Request) {
  // traced starts a trace span when the POST endpoint is used
  // Unlike wrapTraced, traced does not natively log inputs and outputs.
  return traced(
    async (span) => {
      const url = new URL(request.url);
      const mode = url.searchParams.get("mode");
      const { messages }: { messages: Message[] } = await request.json();

      const stream = await streamText({
        // Our wrapped OpenAI model
        model: model,
        system: `\
        - you are an AI assistant who gives the weather. If the user gives you a location, give them the current weather in that location in Fahrenheit.
      `,
        messages: messages,
        // Important: maxSteps prevents infinite tool call loops but will stop your LLM's logic prematurely if set too low
        maxSteps: 5,
        // Register the exported tools to the LLM from @/components/tools
        tools: {
          getWeather: getWeather,
          getFahrenheit: getFahrenheit,
        },
        // Enable experimental telemetry
        experimental_telemetry: {
          isEnabled: true,
        },
        // When streamText is finished, log the input, output, and simple online scores
        onFinish: (result) => {
          const text = result.text ?? "";
          const mentionsFahrenheit = /fahrenheit|\bF\b/i.test(text);
          const hasNumber = /\d+/.test(text);
          const span = currentSpan();
          span.log({
            input: messages,
            output: text,
            metadata: { model: "gpt-4o" },
            scores: {
              fahrenheit_presence: mentionsFahrenheit ? 1 : 0,
              contains_number: hasNumber ? 1 : 0,
            },
          });

          // Fire-and-forget: compute LLM-judge scores and update the span
          (async () => {
            try {
              const [weatherJudge, generalJudge] = await Promise.all([
                weatherLLMJudgeScore({ input: messages?.[messages.length - 1]?.content, output: text }),
                generalLLMJudgeScore({ input: messages?.[messages.length - 1]?.content, output: text }),
              ]);

              // Optional: lightweight content_accuracy using generic phrases
              const contentScore = contentAccuracyScore({
                output: text,
                expected: { requiredPhrases: ["temperature", "weather"] },
              });

              await logger.updateSpan({
                id: span.id,
                scores: {
                  ...((weatherJudge?.score != null) ? { weather_llm_judge: weatherJudge.score } : {}),
                  ...((generalJudge?.score != null) ? { general_llm_judge: generalJudge.score } : {}),
                  ...((contentScore?.score != null) ? { content_accuracy: contentScore.score } : {}),
                },
                metadata: {
                  online_eval: {
                    weather_llm_judge: weatherJudge?.metadata,
                    general_llm_judge: generalJudge?.metadata,
                    content_accuracy: contentScore?.metadata,
                  },
                },
              });
            } catch (e) {
              // Best-effort; do not disrupt request
            }
          })();
        },
      });

      // Support plain text streaming for evals (avoids frame output in experiments)
      if (mode === "text") {
        return stream.toTextStreamResponse();
      }
      return stream.toDataStreamResponse();
    },
    // Show this span as a function and name the span POST /api/chat.
    { type: "function", name: "POST /api/chat" },
  );
}
