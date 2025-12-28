import { OpenAIModelsListResponseBody } from "../openai/types";
import { ProviderBase } from "../provider";
import { AnthropicEndpoint } from "./endpoint";
import { AnthropicModelsListResponseBody } from "./types";

export class Anthropic extends ProviderBase {
  readonly chatCompletionPath: string = "/v1/chat/completions";
  readonly modelsPath: string = "/v1/models";

  readonly apiKeyName: keyof Env = "ANTHROPIC_API_KEY";

  endpoint: AnthropicEndpoint;

  constructor() {
    super();
    this.endpoint = new AnthropicEndpoint(this.apiKeyName);
  }

  // Convert model list to OpenAI format
  modelsToOpenAIFormat(
    data: AnthropicModelsListResponseBody,
  ): OpenAIModelsListResponseBody {
    return {
      object: "list",
      data: data.data.map(({ id, type, created_at, ...model }) => ({
        id,
        object: type,
        created: Math.floor(Date.parse(created_at) / 1000),
        owned_by: "anthropic",
        _: model,
      })),
    };
  }
}
