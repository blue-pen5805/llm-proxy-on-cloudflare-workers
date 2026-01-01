import { ProviderBase, ProviderNotSupportedError } from "../provider";

export class Replicate extends ProviderBase {
  get chatCompletionPath(): string {
    return "";
  }
  get modelsPath(): string {
    return "";
  }

  readonly apiKeyName: keyof Env = "REPLICATE_API_KEY";
  readonly baseUrlProp: string = "https://api.replicate.com/v1";

  async buildChatCompletionsRequest({
    body, // eslint-disable-line @typescript-eslint/no-unused-vars
    headers = {}, // eslint-disable-line @typescript-eslint/no-unused-vars
  }: {
    body: string;
    headers: HeadersInit;
  }): Promise<[string, RequestInit]> {
    throw new ProviderNotSupportedError(
      "Replicate does not support chat completions",
    );
  }
  async buildModelsRequest(): Promise<[string, RequestInit]> {
    throw new ProviderNotSupportedError(
      "Replicate does not support models list via this proxy.",
    );
  }
}
