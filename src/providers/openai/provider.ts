import { defineProvider, type Provider } from "../provider";

export type OpenAI = Provider;

export const OpenAI = defineProvider({
  openAICompatible: true,
  apiKeyName: "OPENAI_API_KEY",
  baseUrl: "https://api.openai.com/v1",
});
