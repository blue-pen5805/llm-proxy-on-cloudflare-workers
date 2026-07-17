import { Secrets } from "../../utils/secrets";
import { OpenAIModelsListResponseBody } from "../openai/types";
import { defineProvider, type Provider } from "../provider";
import { AnthropicModelsListResponseBody } from "./types";

export type Anthropic = Provider;

export const Anthropic = defineProvider({
  apiKeyName: "ANTHROPIC_API_KEY",
  baseUrl: "https://api.anthropic.com",
  chatCompletionPath: "/v1/chat/completions",
  modelsPath: "/v1/models",
  async headers(apiKeyIndex): Promise<HeadersInit> {
    const apiKey = Secrets.get("ANTHROPIC_API_KEY", apiKeyIndex);
    return {
      "Content-Type": "application/json",
      "x-api-key": `${apiKey}`,
      "anthropic-version": "2023-06-01",
    };
  },

  // Convert model list to OpenAI format
  convertModelsToOpenAIFormat(data): OpenAIModelsListResponseBody {
    const providerResponse = data as AnthropicModelsListResponseBody;
    return {
      object: "list",
      data: providerResponse.data.map(({ id, type, created_at, ...model }) => ({
        id,
        object: type,
        created: Math.floor(Date.parse(created_at) / 1000),
        owned_by: "anthropic",
        _: model,
      })),
    };
  },
});
