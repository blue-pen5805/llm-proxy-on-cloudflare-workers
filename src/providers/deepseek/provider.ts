import { defineProvider } from "../provider";

export const DeepSeek = defineProvider({
  openAICompatible: true,
  apiKeyName: "DEEPSEEK_API_KEY",
  baseUrl: "https://api.deepseek.com",
});
