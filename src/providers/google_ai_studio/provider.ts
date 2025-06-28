import { Secrets } from "../../utils/secrets";
import {
  OpenAIChatCompletionsRequestBody,
  OpenAIModelsListResponseBody,
} from "../openai/types";
import { ProviderBase } from "../provider";
import {
  GoogleAiStudioEndpoint,
  GoogleAiStudioOpenAICompatibleEndpoint,
} from "./endpoint";
import { GoogleAiStudioModelsListResponseBody } from "./types";

export class GoogleAiStudio extends ProviderBase {
  readonly chatCompletionPath: string = "/v1beta/openai/chat/completions";
  readonly modelsPath: string = "/v1beta/models";

  readonly apiKeyName: keyof Env = "GEMINI_API_KEY";

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

  endpoint: GoogleAiStudioEndpoint;

  constructor() {
    super();
    this.endpoint = new GoogleAiStudioEndpoint(Secrets.get(this.apiKeyName));
  }

  async fetch(
    pathname: string,
    init?: Parameters<typeof fetch>[1],
  ): ReturnType<typeof fetch> {
    if (pathname.startsWith("/v1beta/openai")) {
      const openaiCompatibleEndpoint =
        new GoogleAiStudioOpenAICompatibleEndpoint(this.endpoint);
      return openaiCompatibleEndpoint.fetch(
        pathname.replace("/v1beta/openai", ""),
        init,
      );
    } else {
      return this.endpoint.fetch(pathname, init);
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
