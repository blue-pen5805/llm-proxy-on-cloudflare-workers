import { defineProvider } from "../provider";

export const Grok = defineProvider({
  openAICompatible: true,
  apiKeyName: "GROK_API_KEY",
  baseUrl: "https://api.x.ai",
  chatCompletionPath: "/v1/chat/completions",
  modelsPath: "/v1/models",
});
