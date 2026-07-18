import { defineProvider, type Provider } from "../provider";

export type Ollama = Provider;

export const Ollama = defineProvider({
  openAICompatible: true,
  apiKeyName: "OLLAMA_API_KEY",
  baseUrl: "https://ollama.com",
  pathnamePrefix: "/v1",
});
