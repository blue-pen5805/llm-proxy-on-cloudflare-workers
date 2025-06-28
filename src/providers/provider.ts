import { EndpointBase } from "./endpoint";
import {
  OpenAIChatCompletionsRequestBody,
  OpenAIModelsListResponseBody,
} from "./openai/types";

export class ProviderBase {
  readonly apiKeyName: keyof Env | undefined = undefined;
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
  buildChatCompletionsRequest({
    body,
    headers = {},
  }: {
    body: string;
    headers: HeadersInit;
  }): [string, RequestInit] {
    const data = JSON.parse(body) as OpenAIChatCompletionsRequestBody;
    const trimmedData = Object.fromEntries(
      (Object.keys(data) as (keyof OpenAIChatCompletionsRequestBody)[])
        .map((key) =>
          this.CHAT_COMPLETIONS_SUPPORTED_PARAMETERS.includes(key)
            ? [key, data[key]]
            : null,
        )
        .filter((x) => x !== null),
    );

    return [
      this.chatCompletionPath,
      {
        method: "POST",
        body: JSON.stringify(trimmedData),
        headers: {
          ...this.endpoint.headers(),
          ...headers,
        },
      },
    ];
  }

  // Model List
  buildModelsRequest(): [string, RequestInit] {
    return [
      this.modelsPath,
      {
        method: "GET",
        headers: this.endpoint.headers(),
      },
    ];
  }

  // Convert model list to OpenAI format
  modelsToOpenAIFormat(
    data: any, // Replace 'any' with the actual type if available,
  ): OpenAIModelsListResponseBody {
    return data as OpenAIModelsListResponseBody;
  }
}

export class ProviderNotSupportedError extends Error {}
