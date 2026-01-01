import { Secrets } from "../../utils/secrets";
import {
  OpenAIChatCompletionsRequestBody,
  OpenAIModelsListResponseBody,
} from "../openai/types";
import { ProviderBase } from "../provider";
import { GoogleAiStudioModelsListResponseBody } from "./types";

export class GoogleAiStudio extends ProviderBase {
  get chatCompletionPath(): string {
    return "/v1beta/openai/chat/completions";
  }
  get modelsPath(): string {
    return "/v1beta/models";
  }

  readonly apiKeyName: keyof Env = "GEMINI_API_KEY";
  readonly baseUrlProp: string = "https://generativelanguage.googleapis.com";

  readonly CHAT_COMPLETIONS_SUPPORTED_PARAMETERS: (keyof OpenAIChatCompletionsRequestBody)[] =
    [
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
    ];

  async headers(apiKeyIndex?: number): Promise<HeadersInit> {
    const apiKey = Secrets.get(this.apiKeyName, apiKeyIndex);
    return {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    };
  }

  async fetch(
    pathname: string,
    init?: Parameters<typeof fetch>[1],
    apiKeyIndex?: number,
  ): ReturnType<typeof fetch> {
    if (pathname.startsWith("/v1beta/openai")) {
      const apiKey = Secrets.get(this.apiKeyName, apiKeyIndex);

      const newHeaders: Record<string, string> = {
        ...(init?.headers as Record<string, string>),
        Authorization: `Bearer ${apiKey}`,
      };
      delete newHeaders["x-goog-api-key"];

      return super.fetch(
        pathname,
        {
          ...init,
          headers: newHeaders,
        },
        apiKeyIndex,
      );
    } else {
      return super.fetch(pathname, init, apiKeyIndex);
    }
  }

  // Convert model list to OpenAI format
  modelsToOpenAIFormat(
    data: GoogleAiStudioModelsListResponseBody,
  ): OpenAIModelsListResponseBody {
    return {
      object: "list",
      data: data.models.map(({ name, ...model }) => ({
        id: `${name.replace("models/", "")}`,
        object: "model",
        created: 0,
        owned_by: "google_ai_studio",
        _: model,
      })),
    };
  }
}
