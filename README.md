# Braintrust Tracing + Evals (Next.js + Vercel AI SDK)

Production-ready tracing and evaluations for a weather chat app built with Next.js and the Vercel AI SDK, instrumented with Braintrust for online/offline scoring.

## Overview

- Next.js app with Vercel AI SDK tools and streaming responses
- Braintrust tracing: root span for each request, tool sub-spans, automatic model I/O tracing
- Online (“in-app”) evaluators scored at the end of each user request
- Offline evaluations via Braintrust `Eval` with shared scorers

## Prerequisites

- Node 18+
- Braintrust account and API key
- OpenAI API key (or use Braintrust AI providers proxy)

## Environment variables

Create `.env.local` in the project root:

```
BRAINTRUST_API_KEY=<your-braintrust-api-key>
BRAINTRUST_PROJECT_NAME=<your-braintrust-project-name>
OPENAI_API_KEY=<your-openai-api-key>
OTEL_EXPORTER_OTLP_ENDPOINT=https://api.braintrust.dev/otel
OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer <your-braintrust-api-key>, x-bt-parent=project_id:<your-braintrust-project-name>"
```

## Install and run

```
npm install
npm run dev
# open http://localhost:3000
```

## Key files

- `app/(preview)/api/chat/route.ts`
  - Wraps the Vercel AI SDK OpenAI model with `wrapAISDKModel`
  - Wraps the `POST` handler in a `traced` span named `POST /api/chat`
  - Logs input/output and simple online scores (`fahrenheit_presence`, `contains_number`)
  - Adds asynchronous LLM-judge and content scores via `logger.updateSpan`
  - Supports `?mode=text` to return plain text (useful for experiments)

- `components/tools.ts`
  - Weather tools are wrapped with `wrapTraced` so tool calls appear as child spans

- `lib/braintrust.ts`
  - Initializes the Braintrust logger and re-exports helpers: `traced`, `wrapTraced`, `wrapAISDKModel`, `currentSpan`

- `lib/scorers.ts`
  - Shared scorer implementations used by both online tracing and offline evals:
    - `contentAccuracyScore`: synonym- and partial-match tolerant; adds lenient score floors
    - `weatherLLMJudgeScore`: lenient weather-domain LLM judge (uses `openai("gpt-4o-mini")`)
    - `generalLLMJudgeScore`: general lenient LLM judge (uses `openai("gpt-4o-mini")`)
  - All include calibration metadata and bounded scores in [0, 1]

- `scripts/eval.agent.ts`
  - Offline evaluation using `Eval` with a set of test cases
  - Calls the local API with `http://localhost:3000/api/chat?mode=text` for clean, plain-text outputs
  - Uses the shared scorers from `lib/scorers.ts`

## Online scoring (in-app)

In `route.ts`, we log simple online metrics and also asynchronously compute LLM-judge and content scores after the model finishes:

- Simple scores:
  - `fahrenheit_presence`: 1 if response mentions Fahrenheit (or `F`), else 0
  - `contains_number`: 1 if response contains any digit, else 0
- LLM-judge scores (async, non-blocking):
  - `weather_llm_judge`: lenient, weather-focused judge
  - `general_llm_judge`: lenient, general-purpose judge
  - `content_accuracy`: tolerant phrase-based accuracy with calibration

These scores are attached to the same root span with `logger.updateSpan`.

## Offline evaluations

Run a full evaluation across curated test cases with shared scorers:

```
npm run eval:agent
```

This will create a new Braintrust experiment (visible in your project) with:

- Scores: `content_accuracy`, `general_llm_judge`, `weather_llm_judge`
- Per-datapoint metadata: reasons, calibration details, and feedback

## Plain-text output for experiments

By default, the Vercel AI SDK returns a stream with frames. To store clean text in experiments, the API supports:

```
POST /api/chat?mode=text
```

This returns a concatenated text stream as the HTTP response body, which the evaluation script uses.

## Changing the judge model or thresholds

Edit `lib/scorers.ts`:

- Switch the judge model by changing `openai("gpt-4o-mini")` to another (e.g., `openai("gpt-4o")`).
- Adjust leniency by tweaking the soft-floor thresholds in each scorer’s calibration.

## Troubleshooting

- No logs in Braintrust:
  - Ensure `BRAINTRUST_API_KEY` and `BRAINTRUST_PROJECT_NAME` are set in `.env.local`
  - Confirm the app is running and requests are hitting `/api/chat`
- Evals fail with missing keys:
  - `scripts/eval.agent.ts` loads `.env.local` via `dotenv`; confirm the file exists and contains keys
- Frame-like experiment outputs:
  - Ensure eval is calling `http://localhost:3000/api/chat?mode=text`

## Notes

- Logging is best-effort and non-blocking: if online LLM-judge scoring fails, the user response is still returned
- Tool calls are traced with preserved hierarchy under the request’s root span

## Scripts

```
npm run dev         # Start Next.js
npm run eval:agent  # Run offline evaluation
```


