import { defineProvider } from "../provider";

export const OpenAI = defineProvider({
  openAICompatible: true,
  apiKeyName: "OPENAI_API_KEY",
  baseUrl: "https://api.openai.com/v1",
});
