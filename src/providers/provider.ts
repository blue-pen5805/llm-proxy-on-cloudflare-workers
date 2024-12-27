import { EndpointBase } from "./endpoint";
import { fetch2 } from "../utils";
import {
  OpenAIChatCompletionsRequestBody,
  OpenAIModelsListResponseBody,
} from "./openai/types";

export class ProviderBase {
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

  apiKey: keyof Env;
  endpoint: EndpointBase;

  constructor({ apiKey }: { [key: string]: string }) {
    this.apiKey = apiKey as keyof Env;
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

  // OpenAI Comaptible API - Chat Completions
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

    const response = await fetch2(
      ...this.chatCompletionsRequestData({
        body: this.chatCompletionsRequestBody(body),
        headers,
      }),
    );

    if (!isStream) {
      return await this.processChatCompletions(response, model);
    } else {
      return await this.processChatCompletionsStream(response, model);
    }
  }

  async processChatCompletions(
    response: Response,
    _model?: string,
  ): Promise<Response> {
    return response;
  }

  async processChatCompletionsStream(
    response: Response,
    _model?: string,
  ): Promise<Response> {
    return response;
  }

  chatCompletionsRequestData({
    body,
    headers = {},
  }: {
    body: string;
    headers: HeadersInit;
  }) {
    return this.endpoint.requestData("/chat/completions", {
      method: "POST",
      headers,
      body,
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

  // OpenAI Comaptible API - Models
  async listModels(): Promise<OpenAIModelsListResponseBody> {
    const response = await this.fetchModels();

    return (await response.json()) as OpenAIModelsListResponseBody;
  }

  async fetchModels(): Promise<Response> {
    return await this.fetch("/models", {
      method: "GET",
    });
  }
}
