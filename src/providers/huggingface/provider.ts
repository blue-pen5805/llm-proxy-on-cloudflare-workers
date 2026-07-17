import {
  defineProvider,
  ProviderNotSupportedError,
  type Provider,
} from "../provider";

export type HuggingFace = Provider;

export const HuggingFace = defineProvider({
  apiKeyName: "HUGGINGFACE_API_KEY",
  baseUrl: "https://api-inference.huggingface.co/models",
  chatCompletionPath: "",
  modelsPath: "",
  async buildChatCompletionsRequest({
    body, // eslint-disable-line @typescript-eslint/no-unused-vars
    headers, // eslint-disable-line @typescript-eslint/no-unused-vars
  }: {
    body: string;
    headers: HeadersInit;
  }): Promise<[string, RequestInit]> {
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
