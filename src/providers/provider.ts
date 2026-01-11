import { fetch2 } from "../utils/helpers";
import { Secrets } from "../utils/secrets";
import {
  OpenAIChatCompletionsRequestBody,
  OpenAIModelsListResponseBody,
} from "./openai/types";

export class ProviderBase {
  // --- Configuration Properties ---
  readonly apiKeyName: keyof Env | undefined = undefined;
  readonly baseUrlProp: string = "https://example.com";
  readonly pathnamePrefixProp: string = "";
  get chatCompletionPath(): string {
    return "/chat/completions";
  }
  get modelsPath(): string {
    return "/models";
  }

  // --- Core Methods ---
  available(): boolean {
    return this.getApiKeys().length > 0;
  }

  getApiKeys(): string[] {
    if (this.apiKeyName) {
      return Secrets.getAll(this.apiKeyName);
    }
    return [];
  }

  async getNextApiKeyIndex(): Promise<number> {
    const keys = this.getApiKeys();
    if (keys.length <= 1) {
      return 0;
    }

    if (this.apiKeyName) {
      return await Secrets.getNext(this.apiKeyName);
    }

    // Fallback for providers without apiKeyName (like CustomOpenAI will override this)
    return 0;
  }

  async fetch(
    pathname: string,
    init?: RequestInit,
    apiKeyIndex?: number,
  ): Promise<Response> {
    return fetch2(...(await this.buildRequest(pathname, init, apiKeyIndex)));
  }

  // --- URL & Header Construction ---
  baseUrl(): string {
    return this.baseUrlProp;
  }

  pathnamePrefix(): string {
    return this.pathnamePrefixProp;
  }

  async headers(_apiKeyIndex?: number): Promise<HeadersInit> {
    return {};
  }

  async buildRequest(
    pathname: string,
    init?: RequestInit,
    apiKeyIndex?: number,
  ): Promise<[string, RequestInit]> {
    return [
      this.baseUrl() + this.pathnamePrefix() + pathname,
      await this.requestData(init, apiKeyIndex),
    ];
  }

  async requestData(
    init?: RequestInit,
    apiKeyIndex?: number,
  ): Promise<RequestInit> {
    return {
      ...init,
      headers: {
        ...init?.headers,
        ...(await this.headers(apiKeyIndex)),
      },
    };
  }

  // --- OpenAI Compatible API Methods ---
  async buildChatCompletionsRequest({
    body,
    headers = {},
    apiKeyIndex,
  }: {
    body: string;
    headers: HeadersInit;
    apiKeyIndex?: number;
  }): Promise<[string, RequestInit]> {
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
          ...(await this.headers(apiKeyIndex)),
          ...headers,
        },
      },
    ];
  }

  async buildModelsRequest(
    apiKeyIndex?: number,
  ): Promise<[string, RequestInit]> {
    return [
      this.modelsPath,
      {
        method: "GET",
        headers: await this.headers(apiKeyIndex),
      },
    ];
  }

  modelsToOpenAIFormat(data: any): OpenAIModelsListResponseBody {
    return data as OpenAIModelsListResponseBody;
  }

  staticModels(): OpenAIModelsListResponseBody | undefined {
    return undefined;
  }

  // --- Constants & Metadata ---
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
}

export class OpenAICompatibleProvider extends ProviderBase {
  async headers(apiKeyIndex?: number): Promise<HeadersInit> {
    const keys = this.getApiKeys();
    if (keys.length === 0) return {};

    const index = apiKeyIndex !== undefined ? apiKeyIndex % keys.length : 0;
    const apiKey = keys[index];

    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };
  }
}

export class ProviderNotSupportedError extends Error {}
