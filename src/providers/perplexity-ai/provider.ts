import {
  defineProvider,
  ProviderNotSupportedError,
  type Provider,
} from "../provider";

export type PerplexityAi = Provider;

export const PerplexityAi = defineProvider({
  openAICompatible: true,
  apiKeyName: "PERPLEXITYAI_API_KEY",
  baseUrl: "https://api.perplexity.ai",
  chatCompletionPath: "/v1/chat/completions",
  modelsPath: "/v1/models",
  async buildModelsRequest(): Promise<[string, RequestInit]> {
    throw new ProviderNotSupportedError(
      "Perplexity AI does not support models list via this proxy.",
    );
  },
});
