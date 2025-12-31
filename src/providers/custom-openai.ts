import { OpenAICompatibleProvider } from "./provider";

export interface CustomOpenAIEndpointConfig {
  name: string;
  baseUrl: string;
  apiKeys?: string | string[];
}

export class CustomOpenAI extends OpenAICompatibleProvider {
  name: string;

  constructor(private config: CustomOpenAIEndpointConfig) {
    super();
    this.name = config.name;
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

  getApiKeys(): string[] {
    const apiKeys = this.config.apiKeys;
    if (!apiKeys) {
      return [];
    }
    return Array.isArray(apiKeys) ? apiKeys : [apiKeys];
  }
}
