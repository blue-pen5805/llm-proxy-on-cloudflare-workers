import { OpenAIModelsListResponseBody } from "./openai/types";
import { OpenAICompatibleProvider } from "./provider";

export interface CustomOpenAIEndpointConfig {
  name: string;
  baseUrl: string;
  apiKeys?: string | string[];
  models?: string[];
  chatCompletionPath?: string;
  modelsPath?: string;
}

export class CustomOpenAI extends OpenAICompatibleProvider {
  name: string;

  constructor(private config: CustomOpenAIEndpointConfig) {
    super();
    this.name = config.name;
  }

  get chatCompletionPath(): string {
    return this.config.chatCompletionPath ?? super.chatCompletionPath;
  }

  get modelsPath(): string {
    return this.config.modelsPath ?? super.modelsPath;
  }

  baseUrl(): string {
    return this.config.baseUrl;
  }

  async headers(apiKeyIndex?: number): Promise<HeadersInit> {
    const apiKeys = this.config.apiKeys;
    if (!apiKeys) {
      return {
        "Content-Type": "application/json",
      };
    }

    const keys = Array.isArray(apiKeys) ? apiKeys : [apiKeys];
    if (keys.length === 0) {
      return {
        "Content-Type": "application/json",
      };
    }

    // Use modulo for simple round-robin if apiKeyIndex is provided, otherwise random
    const index =
      apiKeyIndex !== undefined
        ? apiKeyIndex % keys.length
        : Math.floor(Math.random() * keys.length);
    const apiKey = keys[index];

    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };
  }

  available(): boolean {
    // Custom endpoints are considered available if they are defined in config
    return true;
  }

  staticModels(): OpenAIModelsListResponseBody | undefined {
    if (!this.config.models || this.config.models.length === 0) {
      return undefined;
    }

    return {
      object: "list",
      data: this.config.models.map((modelId) => ({
        id: modelId,
        object: "model",
        created: Math.floor(Date.now() / 1000),
        owned_by: this.name,
      })),
    };
  }

  getApiKeys(): string[] {
    const apiKeys = this.config.apiKeys;
    if (!apiKeys) {
      return [];
    }
    return Array.isArray(apiKeys) ? apiKeys : [apiKeys];
  }
}
