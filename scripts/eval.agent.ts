import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local" });
import { Eval, EvalCase } from "braintrust";
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { contentAccuracyScore, weatherLLMJudgeScore, generalLLMJudgeScore } from "@/lib/scorers";

type TestCase = EvalCase<
  string,
  {
    requiredPhrases?: string[];
    toolsUsed?: string[];
    expectedTemperature?: string;
    expectedConditions?: string;
  },
  { category: string; difficulty: "easy" | "medium" | "hard" }
>;

const testCases: TestCase[] = [
  // === BASIC WEATHER QUERIES (Easy) ===
  {
    input: "What's the weather in Philadelphia?",
    expected: { 
      requiredPhrases: ["temperature", "Philadelphia", "current"], 
      toolsUsed: ["weatherFunction", "convertToFahrenheit"],
      expectedTemperature: "realistic temperature in Fahrenheit",
      expectedConditions: "current weather conditions"
    },
    metadata: { category: "weather_basic", difficulty: "easy" },
  },
  {
    input: "Weather in New York right now",
    expected: { 
      requiredPhrases: ["temperature", "New York", "current", "now"], 
      toolsUsed: ["weatherFunction", "convertToFahrenheit"],
      expectedTemperature: "current temperature with proper units",
      expectedConditions: "real-time weather data"
    },
    metadata: { category: "weather_basic", difficulty: "easy" },
  },
  {
    input: "Tell me the temperature in London",
    expected: {
      requiredPhrases: ["temperature", "London"],
      toolsUsed: ["weatherFunction"],
      expectedTemperature: "current London temperature",
      expectedConditions: "temperature-focused response"
    },
    metadata: { category: "weather_basic", difficulty: "easy" },
  },

  // === SPECIFIC CONDITIONS (Medium) ===
  {
    input: "Is it raining in Dublin?",
    expected: {
      requiredPhrases: ["rain", "Dublin", "current"],
      toolsUsed: ["weatherFunction"],
      expectedConditions: "yes/no answer about precipitation",
      expectedTemperature: "optional temperature context"
    },
    metadata: { category: "weather_conditions", difficulty: "medium" },
  },
  {
    input: "How hot is it in Kochi right now?",
    expected: {
      requiredPhrases: ["temperature", "Kochi", "hot"],
      toolsUsed: ["weatherFunction"],
      expectedTemperature: "current temperature with heat context",
      expectedConditions: "temperature-focused with descriptive language"
    },
    metadata: { category: "weather_conditions", difficulty: "medium" },
  },
  {
    input: "Is it snowing in Moscow today?",
    expected: {
      requiredPhrases: ["snow", "Moscow", "today"],
      toolsUsed: ["weatherFunction"],
      expectedConditions: "precipitation status with seasonal context",
      expectedTemperature: "temperature supporting snow conditions"
    },
    metadata: { category: "weather_conditions", difficulty: "medium" },
  },
  {
    input: "What's the humidity like in Miami?",
    expected: {
      requiredPhrases: ["humidity", "Miami"],
      toolsUsed: ["weatherFunction"],
      expectedConditions: "humidity information or explanation if unavailable",
      expectedTemperature: "optional temperature context"
    },
    metadata: { category: "weather_conditions", difficulty: "medium" },
  },

  // === AMBIGUOUS LOCATIONS (Hard) ===
  {
    input: "Weather in Paris",
    expected: {
      requiredPhrases: ["Paris", "temperature"],
      toolsUsed: ["weatherFunction"],
      expectedConditions: "should handle Paris, France vs Paris, TX ambiguity",
      expectedTemperature: "temperature for assumed location"
    },
    metadata: { category: "weather_ambiguous", difficulty: "hard" },
  },
  {
    input: "What's it like in Springfield today?",
    expected: {
      requiredPhrases: ["Springfield", "today"],
      toolsUsed: ["weatherFunction"],
      expectedConditions: "should handle multiple Springfield locations",
      expectedTemperature: "temperature for chosen Springfield"
    },
    metadata: { category: "weather_ambiguous", difficulty: "hard" },
  },

  // === COMPARATIVE & COMPLEX (Hard) ===
  {
    input: "Is it warmer in Los Angeles or San Francisco?",
    expected: {
      requiredPhrases: ["Los Angeles", "San Francisco", "warmer", "temperature"],
      toolsUsed: ["weatherFunction"],
      expectedConditions: "comparative analysis of two cities",
      expectedTemperature: "temperatures for both cities with comparison"
    },
    metadata: { category: "weather_comparative", difficulty: "hard" },
  },
  {
    input: "What should I wear in Chicago today based on the weather?",
    expected: {
      requiredPhrases: ["Chicago", "today", "weather"],
      toolsUsed: ["weatherFunction"],
      expectedConditions: "weather-based clothing recommendations",
      expectedTemperature: "temperature influencing clothing advice"
    },
    metadata: { category: "weather_advisory", difficulty: "hard" },
  },

  // === INTERNATIONAL LOCATIONS (Medium-Hard) ===
  {
    input: "Current weather in Tokyo",
    expected: {
      requiredPhrases: ["Tokyo", "current", "weather"],
      toolsUsed: ["weatherFunction"],
      expectedConditions: "international location handling",
      expectedTemperature: "temperature in appropriate units"
    },
    metadata: { category: "weather_international", difficulty: "medium" },
  },
  {
    input: "How's the weather in São Paulo?",
    expected: {
      requiredPhrases: ["São Paulo", "weather"],
      toolsUsed: ["weatherFunction"],
      expectedConditions: "handles special characters in city names",
      expectedTemperature: "current temperature"
    },
    metadata: { category: "weather_international", difficulty: "medium" },
  },
  {
    input: "Temperature in Mumbai right now",
    expected: {
      requiredPhrases: ["Mumbai", "temperature", "right now"],
      toolsUsed: ["weatherFunction"],
      expectedConditions: "real-time data for major international city",
      expectedTemperature: "current Mumbai temperature"
    },
    metadata: { category: "weather_international", difficulty: "medium" },
  },

  // === TEMPORAL QUERIES (Medium-Hard) ===
  {
    input: "What was the weather like yesterday in Boston?",
    expected: {
      requiredPhrases: ["yesterday", "Boston"],
      toolsUsed: ["weatherFunction"],
      expectedConditions: "should handle historical vs current data limitations",
      expectedTemperature: "explanation of temporal limitations"
    },
    metadata: { category: "weather_temporal", difficulty: "hard" },
  },
  {
    input: "Will it rain tomorrow in Seattle?",
    expected: {
      requiredPhrases: ["tomorrow", "rain", "Seattle"],
      toolsUsed: ["weatherFunction"],
      expectedConditions: "should handle forecast vs current data limitations",
      expectedTemperature: "optional forecast context"
    },
    metadata: { category: "weather_temporal", difficulty: "hard" },
  },

  // === ERROR HANDLING & EDGE CASES (Hard) ===
  {
    input: "Weather in Atlantis",
    expected: {
      requiredPhrases: ["Atlantis"],
      toolsUsed: ["weatherFunction"],
      expectedConditions: "graceful handling of non-existent location",
      expectedTemperature: "error handling response"
    },
    metadata: { category: "weather_edge_cases", difficulty: "hard" },
  },
  {
    input: "What's the weather?",
    expected: {
      requiredPhrases: ["weather"],
      toolsUsed: ["weatherFunction"],
      expectedConditions: "should ask for location clarification",
      expectedTemperature: "explanation of location requirement"
    },
    metadata: { category: "weather_edge_cases", difficulty: "hard" },
  },
  {
    input: "Is it hot?",
    expected: {
      requiredPhrases: ["hot"],
      toolsUsed: [],
      expectedConditions: "should ask for location specification",
      expectedTemperature: "explanation of missing location"
    },
    metadata: { category: "weather_edge_cases", difficulty: "hard" },
  },

  // === CONVERSATIONAL & NATURAL LANGUAGE (Medium) ===
  {
    input: "It's so cold here in Denver, what's the actual temperature?",
    expected: {
      requiredPhrases: ["Denver", "temperature", "cold"],
      toolsUsed: ["weatherFunction"],
      expectedConditions: "conversational response with temperature data",
      expectedTemperature: "actual Denver temperature"
    },
    metadata: { category: "weather_conversational", difficulty: "medium" },
  },
  {
    input: "Should I bring an umbrella in Portland today?",
    expected: {
      requiredPhrases: ["Portland", "today", "umbrella"],
      toolsUsed: ["weatherFunction"],
      expectedConditions: "rain-focused advice with current conditions",
      expectedTemperature: "weather context for umbrella decision"
    },
    metadata: { category: "weather_advisory", difficulty: "medium" },
  },
  {
    input: "Perfect beach weather in San Diego?",
    expected: {
      requiredPhrases: ["San Diego", "beach", "weather"],
      toolsUsed: ["weatherFunction"],
      expectedConditions: "weather assessment for beach activities",
      expectedTemperature: "temperature suitable for beach"
    },
    metadata: { category: "weather_advisory", difficulty: "medium" },
  },

  // === UNIT PREFERENCES (Medium) ===
  {
    input: "Temperature in Toronto in Celsius",
    expected: {
      requiredPhrases: ["Toronto", "Celsius", "temperature"],
      toolsUsed: ["weatherFunction"],
      expectedConditions: "temperature specifically in Celsius",
      expectedTemperature: "Celsius temperature format"
    },
    metadata: { category: "weather_units", difficulty: "medium" },
  },
  {
    input: "How many degrees Fahrenheit in Phoenix?",
    expected: {
      requiredPhrases: ["Phoenix", "Fahrenheit", "degrees"],
      toolsUsed: ["weatherFunction", "convertToFahrenheit"],
      expectedConditions: "temperature in Fahrenheit format",
      expectedTemperature: "explicit Fahrenheit temperature"
    },
    metadata: { category: "weather_units", difficulty: "medium" },
  },

  // === MULTIPLE CONDITIONS (Hard) ===
  {
    input: "Weather conditions, temperature, and visibility in Las Vegas",
    expected: {
      requiredPhrases: ["Las Vegas", "temperature", "conditions", "weather"],
      toolsUsed: ["weatherFunction"],
      expectedConditions: "comprehensive weather report",
      expectedTemperature: "temperature as part of full conditions"
    },
    metadata: { category: "weather_comprehensive", difficulty: "hard" },
  },
  {
    input: "Give me a full weather report for Dallas",
    expected: {
      requiredPhrases: ["Dallas", "weather", "report"],
      toolsUsed: ["weatherFunction"],
      expectedConditions: "detailed weather information",
      expectedTemperature: "temperature within comprehensive report"
    },
    metadata: { category: "weather_comprehensive", difficulty: "hard" },
  }
];

// Helper utilities for softer matching
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
  // If phrase is a known weather keyword, allow synonyms
  const base = p.split(" ")[0];
  const syns = weatherSynonyms[base] || [];
  if (outNorm.includes(p)) return true;
  for (const s of syns) {
    if (outNorm.includes(normalize(s))) return true;
  }
  // For multi-word phrases, consider partial token overlap
  const tokens = p.split(" ").filter(Boolean);
  const matched = tokens.filter((tok) => outNorm.includes(tok));
  return tokens.length > 0 && matched.length / tokens.length >= 0.6;
}

const contentAccuracyScorer = (args: any) => contentAccuracyScore(args);

// Weather-specific LLM-as-judge scorer
async function weatherLLMJudgeScorer(args: any) {
  return weatherLLMJudgeScore(args);
}

// General LLM judge scorer (lenient)
async function llmJudgeScorer(args: any) {
  return generalLLMJudgeScore(args);
}

async function task(input: string) {
  const res = await fetch("http://localhost:3000/api/chat?mode=text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: input }] }),
  });
  return await res.text();
}

Eval(process.env.BRAINTRUST_PROJECT_NAME || "Agent Eval Poc", {
  data: testCases,
  task,
  scores: [
    contentAccuracyScorer as any,
    weatherLLMJudgeScorer as any,  // Primary weather-specific scorer
    llmJudgeScorer as any          // General comparison scorer
  ],
  experimentName: "Weather Agent Evaluation",
});