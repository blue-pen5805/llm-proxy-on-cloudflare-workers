import { EndpointBase } from "./endpoint";
import {
  OpenAIChatCompletionsRequestBody,
  OpenAIModelsListResponseBody,
} from "./openai/types";

export class ProviderBase {
  readonly chatCompletionPath: string = "/chat/completions";
  readonly modelsPath: string = "/models";

  readonly CHAT_COMPLETIONS_SUPPORTED_PARAMETERS: (keyof OpenAIChatCompletionsRequestBody)[] =
    [
      "messages",
      "model",
      "store",
      "metadata",
      "frequency_penalty",
      "logit_bias",
      "logprobs",
      "max_tokens",
      "max_completion_tokens",
      "n",
      "modalities",
      "prediction",
      "audio",
      "presence_penalty",
      "response_format",
      "seed",
      "service_tier",
      "stop",
      "stream",
      "stream_options",
      "suffix",
      "temperature",
      "top_p",
      "tools",
      "tool_choice",
      "parallel_tool_calls",
      "user",
      "function_call",
      "functions",
    ];

  endpoint: EndpointBase;

  constructor() {
    this.endpoint = new EndpointBase();
  }

  available() {
    return this.endpoint.available();
  }

  async fetch(
    pathname: string,
    init?: Parameters<typeof fetch>[1],
  ): ReturnType<typeof fetch> {
    return this.endpoint.fetch(pathname, init);
  }

  // OpenAI Compatible API - Chat Completions
  async chatCompletions({
    body,
    headers = {},
  }: {
    body: string;
    headers: HeadersInit;
  }): Promise<Response> {
    const { model, stream } = JSON.parse(
      body as string,
    ) as OpenAIChatCompletionsRequestBody;
    const isStream = (stream as boolean | undefined) === true;

    const init = this.chatCompletionsRequestData({
      body: this.chatCompletionsRequestBody(body),
      headers,
    });
    const promise = this.fetch(this.chatCompletionPath, init);

    if (!isStream) {
      return await this.processChatCompletions(promise, model);
    } else {
      return await this.processChatCompletionsStream(promise, model);
    }
  }

  async processChatCompletions(
    promise: Promise<Response>,
    _model?: string,
  ): Promise<Response> {
    return promise;
  }

  async processChatCompletionsStream(
    promise: Promise<Response>,
    _model?: string,
  ): Promise<Response> {
    return promise;
  }

  chatCompletionsRequestData({
    body,
    headers = {},
  }: {
    body: string;
    headers: HeadersInit;
  }) {
    return this.endpoint.requestData({
      method: "POST",
      headers,
      body: this.chatCompletionsRequestBody(body),
    });
  }

  chatCompletionsRequestBody(body: string): string {
    const data = JSON.parse(body as string) as OpenAIChatCompletionsRequestBody;
    const trimmedData = Object.fromEntries(
      (Object.keys(data) as (keyof OpenAIChatCompletionsRequestBody)[])
        .map((key) =>
          this.CHAT_COMPLETIONS_SUPPORTED_PARAMETERS.includes(key)
            ? [key, data[key]]
            : null,
        )
        .filter((x) => x !== null),
    );

    return JSON.stringify(trimmedData);
  }

  // OpenAI Compatible API - Models
  async listModels(): Promise<OpenAIModelsListResponseBody> {
    const response = await this.fetchModels();

    return (await response.json()) as OpenAIModelsListResponseBody;
  }

  fetchModels(): Promise<Response> {
    return this.fetch(this.modelsPath, {
      method: "GET",
    });
  }
}
