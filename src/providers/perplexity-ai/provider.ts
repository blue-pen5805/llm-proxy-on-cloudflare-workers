import { Secrets } from "../../utils/secrets";
import { OpenAIModelsListResponseBody } from "../openai/types";
import { ProviderBase } from "../provider";
import { PerplexityAiEndpoint } from "./endpoint";

export class PerplexityAi extends ProviderBase {
  readonly chatCompletionPath: string = "/v1/chat/completions";
  readonly modelsPath: string = "/v1/models";

  readonly apiKeyName: keyof Env = "PERPLEXITYAI_API_KEY";

  endpoint: PerplexityAiEndpoint;

  constructor() {
    super();
    this.endpoint = new PerplexityAiEndpoint(Secrets.get(this.apiKeyName));
  }

  async listModels(): Promise<OpenAIModelsListResponseBody> {
    return Promise.resolve({
      object: "list",
      data: [],
    });
  }
}
