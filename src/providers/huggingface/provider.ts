import { ProviderBase, ProviderNotSupportedError } from "../provider";

export class HuggingFace extends ProviderBase {
  get chatCompletionPath(): string {
    return "";
  }
  get modelsPath(): string {
    return "";
  }

  readonly apiKeyName: keyof Env = "HUGGINGFACE_API_KEY";
  readonly baseUrlProp: string = "https://api-inference.huggingface.co/models";

  async buildChatCompletionsRequest({
    body, // eslint-disable-line @typescript-eslint/no-unused-vars
    headers = {}, // eslint-disable-line @typescript-eslint/no-unused-vars
  }: {
    body: string;
    headers: HeadersInit;
  }): Promise<[string, RequestInit]> {
    throw new ProviderNotSupportedError(
      "HuggingFace does not support chat completions",
    );
  }

  async buildModelsRequest(): Promise<[string, RequestInit]> {
    throw new ProviderNotSupportedError(
      "HuggingFace does not support models list via this proxy.",
    );
  }
}
