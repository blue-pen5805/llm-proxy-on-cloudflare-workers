import type { CustomOpenAIEndpointConfig } from "../utils/config";
import {
  DEFAULT_PROVIDER_PROFILE,
  PROVIDER_PROFILE_PATTERN,
  Secrets,
} from "../utils/secrets";
import { chatCompletionsEndpoint, jsonEndpoint } from "./inference";
import { OpenAIModelsListResponseBody } from "./openai/types";
import { defineProvider, Provider, ProviderConstructor } from "./provider";

export type { CustomOpenAIEndpointConfig } from "../utils/config";

export type CustomOpenAI = Provider & { readonly name: string };

function assertSafeEndpointConfig(config: CustomOpenAIEndpointConfig): void {
  if (!/^[A-Za-z0-9._~-]{1,128}$/.test(config.name)) {
    throw new Error("Custom OpenAI endpoint name is invalid.");
  }
  let baseUrl: URL;
  try {
    baseUrl = new URL(config.baseUrl);
  } catch {
    throw new Error("Custom OpenAI endpoint baseUrl must be a valid URL.");
  }
  if (
    baseUrl.protocol !== "https:" ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.search ||
    baseUrl.hash
  ) {
    throw new Error(
      "Custom OpenAI endpoint baseUrl must be an HTTPS origin/path without credentials, query, or fragment.",
    );
  }
}

export const CustomOpenAI = defineProvider<[CustomOpenAIEndpointConfig]>(
  (config) => {
    assertSafeEndpointConfig(config);
    return {
      endpoints: {
        chat_completions: chatCompletionsEndpoint(
          config.chatCompletionPath ?? "/chat/completions",
        ),

        ...(config.responsesPath !== undefined
          ? { responses: jsonEndpoint(config.responsesPath) }
          : {}),
        ...(config.messagesPath !== undefined
          ? { messages: jsonEndpoint(config.messagesPath) }
          : {}),

        models: {
          path: config.modelsPath ?? "/models",
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
        },
      },

      properties: { name: config.name },
      requiresCustomAiGatewayProvider: true,
      baseUrl: config.baseUrl,

      async getNextApiKeyIndex(): Promise<number> {
        const apiKeys = this.getApiKeys();
        return apiKeys.length <= 1
          ? 0
          : Secrets.getNextIndex(
              this.credentialProfile === DEFAULT_PROVIDER_PROFILE
                ? config.name
                : `${config.name}:${this.credentialProfile}`,
              apiKeys.length,
            );
      },

      async headers(apiKeyIndex): Promise<HeadersInit> {
        const apiKeys = this.getApiKeys();
        if (apiKeys.length === 0) return {};
        const selectedApiKeyIndex =
          apiKeyIndex !== undefined ? apiKeyIndex % apiKeys.length : 0;
        return {
          Authorization: `Bearer ${apiKeys[selectedApiKeyIndex]}`,
        };
      },

      // Custom endpoints are available by definition.
      available: () => true,

      getApiKeys(): string[] {
        if (!config.apiKeys) return [];
        const selected =
          typeof config.apiKeys === "object" && !Array.isArray(config.apiKeys)
            ? config.apiKeys[this.credentialProfile]
            : this.credentialProfile === DEFAULT_PROVIDER_PROFILE
              ? config.apiKeys
              : undefined;
        if (!selected) return [];
        return Array.isArray(selected) ? selected : [selected];
      },

      getCredentialProfiles(): string[] {
        if (!config.apiKeys) return [];
        return typeof config.apiKeys === "object" &&
          !Array.isArray(config.apiKeys)
          ? Object.keys(config.apiKeys).filter((profile) =>
              PROVIDER_PROFILE_PATTERN.test(profile),
            )
          : [DEFAULT_PROVIDER_PROFILE];
      },
    };
  },
) as ProviderConstructor<[CustomOpenAIEndpointConfig], CustomOpenAI>;
