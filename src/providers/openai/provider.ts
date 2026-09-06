import { chatCompletionsEndpoint, jsonEndpoint } from "../inference";
import { defineProvider } from "../provider";

export const OpenAI = defineProvider({
  endpoints: {
    chat_completions: chatCompletionsEndpoint(),
    responses: jsonEndpoint("/responses"),
    models: { path: "/models" },
  },

  openAICompatible: true,
  apiKeyName: "OPENAI_API_KEY",
  baseUrl: "https://api.openai.com/v1",
});
