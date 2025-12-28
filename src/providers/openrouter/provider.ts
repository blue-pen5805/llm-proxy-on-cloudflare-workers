import { OpenAIModelsListResponseBody } from "../openai/types";
import { ProviderBase } from "../provider";
import { OpenRouterEndpoint } from "./endpoint";
import { OpenRouterModelsListResponseBody } from "./types";

export class OpenRouter extends ProviderBase {
  readonly chatCompletionPath: string = "/v1/chat/completions";
  readonly modelsPath: string = "/v1/models";

  readonly apiKeyName: keyof Env = "OPENROUTER_API_KEY";

  endpoint: OpenRouterEndpoint;

  constructor() {
    super();
    this.endpoint = new OpenRouterEndpoint(this.apiKeyName);
  }

  // Convert model list to OpenAI format
  modelsToOpenAIFormat(
    data: OpenRouterModelsListResponseBody,
  ): OpenAIModelsListResponseBody {
    return {
      object: "list",
      data: data.data.map(({ id, created, ...model }) => ({
        id,
        object: "model",
        created,
        owned_by: "openrouter",
        _: model,
      })),
    };
  }
}
