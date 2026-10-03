import { jsonEndpoint } from "../inference";
import { convertedChatEndpoint } from "../inference";
import { generateContentEndpoint } from "../native";
import {
  OpenAIChatCompletionsRequestBody,
  OpenAIModelsListResponseBody,
} from "../openai/types";
import { defineProvider } from "../provider";
import { GoogleAiStudioModelsListResponseBody } from "./types";

export const GoogleAiStudio = defineProvider({
  endpoints: {
    chat_completions: jsonEndpoint("/v1beta/openai/chat/completions"),

    models: {
      path: "/v1beta/models",
      convertResponse(data): OpenAIModelsListResponseBody {
        const providerResponse = data as GoogleAiStudioModelsListResponseBody;
        return {
          object: "list",
          data: providerResponse.models.map(({ name, ...model }) => ({
            id: `${name.replace("models/", "")}`,
            object: "model",
            created: 0,
            owned_by: "google_ai_studio",
            _: model,
          })),
        };
      },
    },
  },

  chatFallback: convertedChatEndpoint(generateContentEndpoint, {
    supportedParameters: [
      "messages",
      "model",
      "max_tokens",
      "max_completion_tokens",
      "n",
      "response_format",
      "stop",
      "stream",
      "stream_options",
      "temperature",
      "top_p",
      "tools",
      "tool_choice",
    ] satisfies (keyof OpenAIChatCompletionsRequestBody)[],
  }),
  apiKeyName: "GEMINI_API_KEY",
  baseUrl: "https://generativelanguage.googleapis.com",

  async headers(apiKeyIndex): Promise<HeadersInit> {
    const apiKeys = this.getApiKeys();
    const apiKey =
      apiKeys.length > 0 ? apiKeys[(apiKeyIndex ?? 0) % apiKeys.length] : null;
    return {
      ...(apiKey ? { "x-goog-api-key": apiKey } : {}),
    };
  },

  async buildHeadersForPath(
    pathname,
    headers,
    apiKeyIndex,
  ): Promise<HeadersInit> {
    const mergedHeaders = new Headers(headers);
    new Headers(await this.headers(apiKeyIndex)).forEach((value, key) => {
      mergedHeaders.set(key, value);
    });
    if (pathname.startsWith("/v1beta/openai")) {
      const apiKey = mergedHeaders.get("x-goog-api-key");
      mergedHeaders.delete("x-goog-api-key");
      if (apiKey) {
        mergedHeaders.set("Authorization", `Bearer ${apiKey}`);
      } else {
        mergedHeaders.delete("Authorization");
      }
    }
    return mergedHeaders;
  },
});
