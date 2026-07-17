import { Secrets } from "../utils/secrets";
import { OpenAIModelsListResponseBody } from "./openai/types";
import { defineProvider, Provider, ProviderConstructor } from "./provider";

export interface CustomOpenAIEndpointConfig {
  name: string;
  baseUrl: string;
  apiKeys?: string | string[];
  models?: string[];
  chatCompletionPath?: string;
  modelsPath?: string;
}

export type CustomOpenAI = Provider & { readonly name: string };

export const CustomOpenAI = defineProvider<[CustomOpenAIEndpointConfig]>(
  (config) => ({
    properties: { name: config.name },
    baseUrl: config.baseUrl,
    chatCompletionPath: config.chatCompletionPath ?? "/chat/completions",
    modelsPath: config.modelsPath ?? "/models",

    async getNextApiKeyIndex(): Promise<number> {
      const apiKeys = this.getApiKeys();
      return apiKeys.length <= 1
        ? 0
        : Secrets.getNextIndex(config.name, apiKeys.length);
    },

    async headers(apiKeyIndex): Promise<HeadersInit> {
      const apiKeys = this.getApiKeys();
      if (apiKeys.length === 0) return { "Content-Type": "application/json" };
      const selectedApiKeyIndex =
        apiKeyIndex !== undefined ? apiKeyIndex % apiKeys.length : 0;
      return {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKeys[selectedApiKeyIndex]}`,
      };
    },

    // Custom endpoints are available by definition.
    available: () => true,

    getStaticModels(): OpenAIModelsListResponseBody | undefined {
      if (!config.models || config.models.length === 0) return undefined;
      return {
        object: "list",
        data: config.models.map((modelId) => ({
          id: modelId,
          object: "model",
          created: Math.floor(Date.now() / 1000),
          owned_by: config.name,
        })),
      };
    },

    getApiKeys(): string[] {
      if (!config.apiKeys) return [];
      return Array.isArray(config.apiKeys) ? config.apiKeys : [config.apiKeys];
    },
  }),
) as ProviderConstructor<[CustomOpenAIEndpointConfig], CustomOpenAI>;
