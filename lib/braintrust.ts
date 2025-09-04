import { initLogger, traced, currentSpan, wrapTraced, wrapAISDKModel } from "braintrust";

// Note: SDK version in this project may not support global masking; skipping.

export const logger = initLogger({
  apiKey: process.env.BRAINTRUST_API_KEY,
  projectName: process.env.BRAINTRUST_PROJECT_NAME,
});

export { traced, currentSpan, wrapTraced, wrapAISDKModel };


