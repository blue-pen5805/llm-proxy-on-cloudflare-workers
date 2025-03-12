import { ProviderBase } from "../provider";
import {
  GoogleAiStudioEndpoint,
  GoogleAiStudioOpenAICompatibleEndpoint,
} from "./endpoint";
import { OpenAIChatCompletionsRequestBody } from "../openai/types";
import { GoogleAiStudioModelsListResponseBody } from "./types";

export class GoogleAiStudio extends ProviderBase {
  readonly chatCompletionPath: string = "/v1beta/openai/chat/completions";
  readonly modelsPath: string = "/v1beta/models";

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

  constructor({ apiKey }: { apiKey: keyof Env }) {
    super({ apiKey });
    this.endpoint = new GoogleAiStudioEndpoint(apiKey);
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

  chatCompletionsRequestData({
    body,
    headers = {},
  }: {
    body: string;
    headers: HeadersInit;
  }) {
    const openaiCompatibleEndpoint = new GoogleAiStudioOpenAICompatibleEndpoint(
      this.endpoint,
    );

    return openaiCompatibleEndpoint.requestData(
      this.chatCompletionPath.replace("/v1beta/openai", ""),
      {
        method: "POST",
        headers,
        body: this.chatCompletionsRequestBody(body),
      },
    );
  }

  async listModels() {
    const response = await this.fetchModels();
    const data =
      (await response.json()) as GoogleAiStudioModelsListResponseBody;

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
