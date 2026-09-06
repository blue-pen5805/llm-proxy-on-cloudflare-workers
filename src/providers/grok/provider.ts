import { chatCompletionsEndpoint, jsonEndpoint } from "../inference";
import { defineProvider } from "../provider";

export const Grok = defineProvider({
  endpoints: {
    chat_completions: chatCompletionsEndpoint("/v1/chat/completions"),
    responses: jsonEndpoint("/v1/responses"),
    models: { path: "/v1/models" },
  },

  openAICompatible: true,
  apiKeyName: "GROK_API_KEY",
  baseUrl: "https://api.x.ai",
});
