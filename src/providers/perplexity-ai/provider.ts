import {
  OpenAICompatibleProvider,
  ProviderNotSupportedError,
} from "../provider";

export class PerplexityAi extends OpenAICompatibleProvider {
  readonly chatCompletionPath: string = "/v1/chat/completions";
  readonly modelsPath: string = "/v1/models";

  readonly apiKeyName: keyof Env = "PERPLEXITYAI_API_KEY";
  readonly baseUrlProp: string = "https://api.perplexity.ai";

  async buildModelsRequest(): Promise<[string, RequestInit]> {
    throw new ProviderNotSupportedError(
      "Perplexity AI does not support models list via this proxy.",
    );
  }
}
