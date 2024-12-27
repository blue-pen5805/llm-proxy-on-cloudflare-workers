import { ProviderBase } from "../provider";
import {
  GoogleAiStudioEndpoint,
  GoogleAiStudioOpenAICompatibleEndpoint,
} from "./endpoint";
import { OpenAIChatCompletionsRequestBody } from "../openai/types";
import { GoogleAiStudioModelsListResponseBody } from "./types";

export class GoogleAiStudio extends ProviderBase {
  readonly CHAT_COMPLETIONS_SUPPORTED_PARAMETERS: (keyof OpenAIChatCompletionsRequestBody)[] =
    [
      "messages",
      "model",
      // "store",
      // "metadata",
      // "frequency_penalty",
      // "logit_bias",
      // "logprobs",
      "max_tokens",
      "max_completion_tokens",
      "n",
      // "modalities",
      // "prediction",
      // "audio",
      // "presence_penalty",
      "response_format",
      // "seed",
      // "service_tier",
      "stop",
      "stream",
      "stream_options",
      // "suffix",
      "temperature",
      "top_p",
      "tools",
      "tool_choice",
      // "parallel_tool_calls",
      // "user",
      // "function_call",
      // "functions",
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

  // OpenAI Comaptible API - Chat Completions
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

    return openaiCompatibleEndpoint.requestData("/chat/completions", {
      method: "POST",
      headers,
      body: this.chatCompletionsRequestBody(body),
    });
  }

  // OpenAI Comaptible API - Models
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

  async fetchModels() {
    return await this.fetch("/v1beta/models", {
      method: "GET",
    });
  }
}
