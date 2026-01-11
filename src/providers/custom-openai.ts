import { Secrets } from "../utils/secrets";
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

  async getNextApiKeyIndex(): Promise<number> {
    const keys = this.getApiKeys();
    if (keys.length <= 1) {
      return 0;
    }

    return await Secrets.getNextIndex(this.name, keys.length);
  }

  async headers(apiKeyIndex?: number): Promise<HeadersInit> {
    const keys = this.getApiKeys();
    if (keys.length === 0) {
      return {
        "Content-Type": "application/json",
      };
    }

    const index = apiKeyIndex !== undefined ? apiKeyIndex % keys.length : 0;
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
