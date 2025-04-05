import { Secrets } from "../../utils/secrets";
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
    this.endpoint = new AnthropicEndpoint(Secrets.get(this.apiKeyName));
  }

  // Anthropic API requires `max_tokens` parameter to be set.
  chatCompletionsRequestBody(body: string): string {
    const trimmedData = JSON.parse(super.chatCompletionsRequestBody(body));
    if (trimmedData["max_tokens"] === undefined) {
      trimmedData["max_tokens"] = 1024;
    }

    return JSON.stringify(trimmedData);
  }

  async listModels() {
    const response = await this.fetchModels();
    const data = (await response.json()) as AnthropicModelsListResponseBody;

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
