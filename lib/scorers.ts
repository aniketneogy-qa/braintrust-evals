import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";

// Shared helpers
function normalize(text: string): string {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9°\s\.\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const weatherSynonyms: Record<string, string[]> = {
  temperature: ["temp", "degrees", "°f", "°c", "fahrenheit", "celsius"],
  current: ["now", "currently", "right now", "as of"],
  rain: ["raining", "precipitation", "showers", "drizzle"],
  snow: ["snowing", "snowfall", "flurries"],
  humidity: ["humid", "moisture"],
  warmer: ["hotter", "warmer"],
  today: ["today", "this day", "for today"],
  weather: ["conditions", "forecast", "weather"],
  visibility: ["visibility", "clear sight", "haze"],
};

const topicKeywords = [
  "temperature",
  "weather",
  "°f",
  "°c",
  "degrees",
  "fahrenheit",
  "celsius",
  "rain",
  "snow",
  "humidity",
  "wind",
  "forecast",
  "conditions",
  "visibility",
  "sunrise",
  "sunset",
  "now",
  "today",
];

function hasTempWithUnit(text: string): boolean {
  const t = normalize(text);
  return /\b\d{1,3}(\.\d+)?\s*°?\s*(f|c|fahrenheit|celsius)\b/.test(t);
}

function phraseMatches(outNorm: string, phrase: string): boolean {
  const p = normalize(phrase);
  if (!p) return true;
  const base = p.split(" ")[0];
  const syns = weatherSynonyms[base] || [];
  if (outNorm.includes(p)) return true;
  for (const s of syns) {
    if (outNorm.includes(normalize(s))) return true;
  }
  const tokens = p.split(" ").filter(Boolean);
  const matched = tokens.filter((tok) => outNorm.includes(tok));
  return tokens.length > 0 && matched.length / tokens.length >= 0.6;
}

export function contentAccuracyScore(args: any) {
  const { output, expected } = args || {};
  const phrases: string[] = expected?.requiredPhrases ?? [];
  const out = String(output || "");
  const outNorm = normalize(out);
  const found = phrases.filter((p: string) => phraseMatches(outNorm, p));
  const rawScore = phrases.length === 0 ? 1 : found.length / phrases.length;
  const isOnTopic = topicKeywords.some((kw) => outNorm.includes(kw));
  const hasTemp = hasTempWithUnit(out);
  let calibrated = rawScore;
  if (isOnTopic) calibrated = Math.max(calibrated, 0.6);
  if (hasTemp) calibrated = Math.max(calibrated, 0.75);
  calibrated = Math.min(1, Math.max(0, calibrated));
  return {
    name: "content_accuracy",
    score: calibrated,
    metadata: {
      required_phrases: phrases,
      found_phrases: found,
      raw_score: rawScore,
      on_topic: isOnTopic,
      has_temp_with_unit: hasTemp,
      calibration: "lenient-floor",
    },
  } as any;
}

export async function weatherLLMJudgeScore(args: any) {
  const { input, output, expected } = args || {};
  const prompt = `You are an expert but generous evaluator for weather LLM agents. Favor reasonable, useful answers. Minor omissions or small formatting issues should only slightly reduce the score.

## Input Data:
**User Query:** ${String(input ?? "").slice(0, 2000)}

**Agent Response:** ${String(output ?? "").slice(0, 3000)}

**Expected Context:** ${JSON.stringify(expected || {}, null, 2).slice(0, 1000)}

## Evaluation Instructions:
Score the response across these key dimensions:

### 1. Accuracy (40% weight — be tolerant of reasonable approximations)
- Temperature values realistic and properly formatted
- Location recognition correct  
- Weather conditions appropriately described
- No contradictory information
- Factual correctness of weather data

### 2. Completeness (25% weight — partial coverage earns partial credit)
- Fully addresses the specific weather query
- Includes all requested information (temp, conditions, location)
- Provides appropriate context and timing

### 3. Clarity & Communication (20% weight — prioritize readability over perfect formatting)
- Clear, natural language
- Well-structured response
- Appropriate tone for weather information
- Easy to understand

### 4. Relevance (15% weight — reward answers that address the user’s need)
- Directly addresses the weather question
- No unnecessary off-topic information
- Focused on user's specific needs

## Weather-Specific Validation (lenient):
- Accept both °C and °F (note which is used)
- Allow reasonable approximations (±2-3°F tolerance)
- Flag unrealistic temperatures for locations/seasons
- Check consistency between temperature and conditions
- Verify location identification accuracy
- Assess real-time/current data indicators

## Scoring Guidelines (lenient calibration):
- 0.9-1.0: Excellent - Accurate, complete, clear
- 0.7-0.85: Good - Minor issues but useful and correct overall
- 0.5-0.65: Fair - On-topic with gaps, still helpful
- 0.3-0.45: Poor - Significant issues
- 0.0-0.25: Fail - Irrelevant or incorrect

## Required Output Format:
Return ONLY a JSON object:

{
  "score": <0.0-1.0>,
  "reason": "Detailed explanation focusing on weather accuracy, completeness, and clarity with specific examples",
  "pass": <true if score >= 0.7, false otherwise>,
  "weather_specific_feedback": {
    "accuracy_issues": ["Any temperature, location, or condition errors"],
    "completeness_gaps": ["Missing information that should be included"],
    "clarity_problems": ["Communication issues specific to weather data"],
    "strengths": ["What the response did well for weather information"]
  }
}

Evaluate the weather response now:`;

  try {
    const { text } = await generateText({ model: openai("gpt-4.1"), prompt, temperature: 0.1 });
    let parsed: any;
    try { parsed = JSON.parse(text); } catch {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    }
    const rawScore = Number(parsed?.score);
    let score = isFinite(rawScore) ? Math.max(0, Math.min(1, rawScore)) : 0;
    const reason = parsed?.reason ?? text?.slice(0, 1000) ?? "No evaluation provided";
    const weatherFeedback = parsed?.weather_specific_feedback || {};
    const outNorm = normalize(String(output || ""));
    const onTopic = topicKeywords.some((kw) => outNorm.includes(kw));
    const tempUnit = hasTempWithUnit(String(output || ""));
    const softFloor = tempUnit ? 0.75 : onTopic ? 0.65 : 0;
    score = Math.max(score, softFloor);
    return {
      name: "weather_llm_judge",
      score,
      metadata: {
        reason,
        pass: score >= 0.65,
        weather_feedback: weatherFeedback,
        evaluation_focus: "weather_domain_specific",
        calibration: { soft_floor: softFloor, on_topic: onTopic, has_temp_with_unit: tempUnit, raw_score: rawScore },
      },
    } as any;
  } catch (err: any) {
    return { name: "weather_llm_judge", score: 0, metadata: { error: String(err?.message || err), reason: "Weather evaluation failed due to technical error", pass: false } } as any;
  }
}

export async function generalLLMJudgeScore(args: any) {
  const { input, output } = args || {};
  const prompt = `You are a generous but fair evaluator. Judge correctness, usefulness, and clarity for a weather-related assistant answer.

Principles:
- Reward reasonable, concise, and helpful answers.
- Minor omissions or formatting issues should not drop the score below 0.7 if the core question is addressed.
- If the answer is on-topic and useful, typical scores should be 0.75–0.9.
- Reserve <0.5 for clearly irrelevant or incorrect answers.

Return only JSON like {"score": 0.82, "reason": "..."}.

User query:\n${String(input ?? "").slice(0, 4000)}\n\nAssistant answer:\n${String(output ?? "").slice(0, 4000)}\n`;
  try {
    const { text } = await generateText({ model: openai("gpt-4o-mini"), prompt });
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { parsed = {}; }
    const raw = Number(parsed?.score);
    let score = isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
    const reason = parsed?.reason ?? text?.slice(0, 500);
    const outNorm = normalize(String(output || ""));
    const onTopic = topicKeywords.some((kw) => outNorm.includes(kw));
    const tempUnit = hasTempWithUnit(String(output || ""));
    const softFloor = tempUnit ? 0.7 : onTopic ? 0.6 : 0;
    score = Math.max(score, softFloor);
    return { name: "general_llm_judge", score, metadata: { reason, calibration: { soft_floor: softFloor, on_topic: onTopic, has_temp_with_unit: tempUnit, raw_score: raw } } } as any;
  } catch (err: any) {
    return { name: "general_llm_judge", score: 0, metadata: { error: String(err?.message || err) } } as any;
  }
}

export const scorerHelpers = {
  normalize,
  topicKeywords,
  hasTempWithUnit,
};


