import { defineProvider, ProviderNotSupportedError } from "../provider";

export const HuggingFace = defineProvider({
  apiKeyName: "HUGGINGFACE_API_KEY",
  baseUrl: "https://api-inference.huggingface.co/models",
  chatCompletionPath: "",
  modelsPath: "",
  async buildChatCompletionsRequest(): Promise<[string, RequestInit]> {
    throw new ProviderNotSupportedError(
      "HuggingFace does not support chat completions",
    );
  },

  async buildModelsRequest(): Promise<[string, RequestInit]> {
    throw new ProviderNotSupportedError(
      "HuggingFace does not support models list via this proxy.",
    );
  },
});
