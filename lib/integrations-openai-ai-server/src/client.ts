import OpenAI from "openai";

const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || "https://api.openai.com/v1";
const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || "mateos-missing-openai-key";

export const openai = new OpenAI({
  apiKey,
  baseURL,
});
