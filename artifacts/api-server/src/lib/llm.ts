import OpenAI from "openai";
import { openai as replitOpenai } from "@workspace/integrations-openai-ai-server";
import { db, preferencesTable } from "@workspace/db";

const PROVIDER_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

const DEFAULT_MODELS: Record<string, string> = {
  openai: "gpt-4o",
  openrouter: "openai/gpt-4o",
  custom: "gpt-4o",
};

export interface LLMClient {
  client: OpenAI;
  model: string;
  miniModel: string;
}

export async function getLLMClient(): Promise<LLMClient> {
  const [prefs] = await db.select({
    customLlmProvider: preferencesTable.customLlmProvider,
    customLlmApiKey: preferencesTable.customLlmApiKey,
    customLlmModel: preferencesTable.customLlmModel,
    customLlmBaseUrl: preferencesTable.customLlmBaseUrl,
  }).from(preferencesTable).limit(1);

  const provider = prefs?.customLlmProvider?.trim() || "replit";
  const apiKey = prefs?.customLlmApiKey?.trim() || "";
  const model = prefs?.customLlmModel?.trim() || "";
  const baseUrl = prefs?.customLlmBaseUrl?.trim() || "";

  if (provider === "replit" || !apiKey) {
    return {
      client: replitOpenai,
      model: "gpt-5.2",
      miniModel: "gpt-4.1-mini",
    };
  }

  const resolvedBaseUrl = PROVIDER_BASE_URLS[provider] ?? baseUrl;

  const clientConfig: ConstructorParameters<typeof OpenAI>[0] = {
    apiKey,
    ...(resolvedBaseUrl ? { baseURL: resolvedBaseUrl } : {}),
  };

  if (provider === "openrouter") {
    clientConfig.defaultHeaders = {
      "HTTP-Referer": "https://mateos.example.com",
      "X-Title": "MateOS",
    };
  }

  const client = new OpenAI(clientConfig);
  const resolvedModel = model || DEFAULT_MODELS[provider] || "gpt-4o";

  return {
    client,
    model: resolvedModel,
    miniModel: resolvedModel,
  };
}
