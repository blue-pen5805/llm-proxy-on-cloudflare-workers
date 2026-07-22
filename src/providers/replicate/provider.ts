import { defineProvider, ProviderNotSupportedError } from "../provider";

export const Replicate = defineProvider({
  apiKeyName: "REPLICATE_API_KEY",
  baseUrl: "https://api.replicate.com/v1",
  chatCompletionPath: "",
  modelsPath: "",
  async buildChatCompletionsRequest(): Promise<[string, RequestInit]> {
    throw new ProviderNotSupportedError(
      "Replicate does not support chat completions",
    );
  },
  async buildModelsRequest(): Promise<[string, RequestInit]> {
    throw new ProviderNotSupportedError(
      "Replicate does not support models list via this proxy.",
    );
  },
});
