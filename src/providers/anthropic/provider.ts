import { Secrets } from "../../utils/secrets";
import { convertedChatEndpoint, jsonEndpoint } from "../inference";
import { messagesEndpoint } from "../native";
import { OpenAIModelsListResponseBody } from "../openai/types";
import { defineProvider } from "../provider";
import { AnthropicModelsListResponseBody } from "./types";

export const Anthropic = defineProvider({
  endpoints: {
    chat_completions: jsonEndpoint("/v1/chat/completions"),
    messages: jsonEndpoint("/v1/messages"),
    models: {
      path: "/v1/models",
      convertResponse(data): OpenAIModelsListResponseBody {
        const providerResponse = data as AnthropicModelsListResponseBody;
        return {
          object: "list",
          data: providerResponse.data.map(
            ({ id, type, created_at, ...model }) => ({
              id,
              object: type,
              created: Math.floor(Date.parse(created_at) / 1000),
              owned_by: "anthropic",
              _: model,
            }),
          ),
        };
      },
    },
  },

  chatFallback: convertedChatEndpoint(messagesEndpoint),
  apiKeyName: "ANTHROPIC_API_KEY",
  baseUrl: "https://api.anthropic.com",

  async headers(apiKeyIndex): Promise<HeadersInit> {
    const apiKey = Secrets.get(
      "ANTHROPIC_API_KEY",
      apiKeyIndex,
      this.credentialProfile,
    );
    return {
      ...(apiKey ? { "x-api-key": apiKey } : {}),
      "anthropic-version": "2023-06-01",
    };
  },

  async buildHeadersForPath(
    pathname,
    headers,
    apiKeyIndex,
  ): Promise<HeadersInit> {
    const merged = new Headers(headers);
    new Headers(await this.headers(apiKeyIndex)).forEach((value, key) => {
      merged.set(key, value);
    });
    if (pathname.startsWith("/v1/chat/completions")) {
      const apiKey = merged.get("x-api-key");
      merged.delete("x-api-key");
      if (apiKey) merged.set("authorization", `Bearer ${apiKey}`);
    }
    return merged;
  },
});
