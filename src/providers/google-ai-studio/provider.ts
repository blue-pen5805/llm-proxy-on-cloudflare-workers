import { fetch2 } from "../../utils/helpers";
import { Secrets } from "../../utils/secrets";
import {
  OpenAIChatCompletionsRequestBody,
  OpenAIModelsListResponseBody,
} from "../openai/types";
import { defineProvider, type Provider } from "../provider";
import { GoogleAiStudioModelsListResponseBody } from "./types";

export type GoogleAiStudio = Provider;

export const GoogleAiStudio = defineProvider({
  apiKeyName: "GEMINI_API_KEY",
  baseUrl: "https://generativelanguage.googleapis.com",
  chatCompletionPath: "/v1beta/openai/chat/completions",
  modelsPath: "/v1beta/models",
  chatCompletionSupportedParameters: [
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

  async headers(apiKeyIndex): Promise<HeadersInit> {
    const apiKey = Secrets.get("GEMINI_API_KEY", apiKeyIndex);
    return {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    };
  },

  async fetch(
    pathname: string,
    init?: Parameters<typeof fetch>[1],
    apiKeyIndex?: number,
  ): ReturnType<typeof fetch> {
    if (pathname.startsWith("/v1beta/openai")) {
      const apiKey = Secrets.get("GEMINI_API_KEY", apiKeyIndex);

      const newHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        ...(init?.headers as Record<string, string>),
        Authorization: `Bearer ${apiKey}`,
      };
      delete newHeaders["x-goog-api-key"];

      return fetch2(this.baseUrl() + pathname, {
        ...init,
        headers: newHeaders,
      });
    } else {
      return fetch2(...(await this.buildRequest(pathname, init, apiKeyIndex)));
    }
  },

  // Convert model list to OpenAI format
  modelsToOpenAIFormat(data): OpenAIModelsListResponseBody {
    const response = data as GoogleAiStudioModelsListResponseBody;
    return {
      object: "list",
      data: response.models.map(({ name, ...model }) => ({
        id: `${name.replace("models/", "")}`,
        object: "model",
        created: 0,
        owned_by: "google_ai_studio",
        _: model,
      })),
    };
  },
});
