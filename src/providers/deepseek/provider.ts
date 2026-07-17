import { defineProvider, type Provider } from "../provider";

export type DeepSeek = Provider;

export const DeepSeek = defineProvider({
  openAICompatible: true,
  apiKeyName: "DEEPSEEK_API_KEY",
  baseUrl: "https://api.deepseek.com",
});
