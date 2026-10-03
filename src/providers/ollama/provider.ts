import { chatCompletionsEndpoint, jsonEndpoint } from "../inference";
import { defineProvider } from "../provider";

export const Ollama = defineProvider({
  endpoints: {
    chat_completions: chatCompletionsEndpoint(),
    responses: jsonEndpoint("/responses"),
    models: { path: "/models" },
  },

  openAICompatible: true,
  apiKeyName: "OLLAMA_API_KEY",
  baseUrl: "https://ollama.com",
  pathnamePrefix: "/v1",
});
