import {
  OpenAICompatibleProvider,
  ProviderNotSupportedError,
} from "../provider";

export class PerplexityAi extends OpenAICompatibleProvider {
  get chatCompletionPath(): string {
    return "/v1/chat/completions";
  }
  get modelsPath(): string {
    return "/v1/models";
  }

  readonly apiKeyName: keyof Env = "PERPLEXITYAI_API_KEY";
  readonly baseUrlProp: string = "https://api.perplexity.ai";

  async buildModelsRequest(): Promise<[string, RequestInit]> {
    throw new ProviderNotSupportedError(
      "Perplexity AI does not support models list via this proxy.",
    );
  }
}
