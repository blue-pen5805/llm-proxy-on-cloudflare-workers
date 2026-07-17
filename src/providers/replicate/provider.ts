import {
  defineProvider,
  ProviderNotSupportedError,
  type Provider,
} from "../provider";

export type Replicate = Provider;

export const Replicate = defineProvider({
  apiKeyName: "REPLICATE_API_KEY",
  baseUrl: "https://api.replicate.com/v1",
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
      "Replicate does not support chat completions",
    );
  },
  async buildModelsRequest(): Promise<[string, RequestInit]> {
    throw new ProviderNotSupportedError(
      "Replicate does not support models list via this proxy.",
    );
  },
});
