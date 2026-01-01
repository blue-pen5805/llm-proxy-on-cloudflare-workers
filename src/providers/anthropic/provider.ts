import { Secrets } from "../../utils/secrets";
import { OpenAIModelsListResponseBody } from "../openai/types";
import { ProviderBase } from "../provider";
import { AnthropicModelsListResponseBody } from "./types";

export class Anthropic extends ProviderBase {
  get chatCompletionPath(): string {
    return "/v1/chat/completions";
  }
  get modelsPath(): string {
    return "/v1/models";
  }

  readonly apiKeyName: keyof Env = "ANTHROPIC_API_KEY";
  readonly baseUrlProp: string = "https://api.anthropic.com";

  async headers(apiKeyIndex?: number): Promise<HeadersInit> {
    const apiKey = Secrets.get(this.apiKeyName, apiKeyIndex);
    return {
      "Content-Type": "application/json",
      "x-api-key": `${apiKey}`,
      "anthropic-version": "2023-06-01",
    };
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
