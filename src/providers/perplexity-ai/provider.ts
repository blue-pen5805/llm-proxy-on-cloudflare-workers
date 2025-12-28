import { ProviderBase, ProviderNotSupportedError } from "../provider";
import { PerplexityAiEndpoint } from "./endpoint";

export class PerplexityAi extends ProviderBase {
  readonly chatCompletionPath: string = "/v1/chat/completions";
  readonly modelsPath: string = "/v1/models";

  readonly apiKeyName: keyof Env = "PERPLEXITYAI_API_KEY";

  endpoint: PerplexityAiEndpoint;

  constructor() {
    super();
    this.endpoint = new PerplexityAiEndpoint(this.apiKeyName);
  }

  async buildModelsRequest(): Promise<[string, RequestInit]> {
    throw new ProviderNotSupportedError(
      "Perplexity AI does not support models list via this proxy.",
    );
  }
}
