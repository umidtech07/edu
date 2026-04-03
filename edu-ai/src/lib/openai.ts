import OpenAI from "openai";

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 30000,  // 30s per request — fail fast instead of waiting minutes
  maxRetries: 1,   // 1 retry max (default is 2)
});
