import { fetch2 } from "../utils/helpers";
import { Secrets } from "../utils/secrets";
import {
  OpenAIChatCompletionsRequestBody,
  OpenAIModelsListResponseBody,
} from "./openai/types";

interface ModelWithMetadata {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

export function modelsToOpenAIFormatWithMetadata<
  T extends ModelWithMetadata,
>(data: { data: T[] }): OpenAIModelsListResponseBody {
  return {
    object: "list",
    data: data.data.map(({ id, object, created, owned_by, ...model }) => ({
      id,
      object,
      created,
      owned_by,
      _: model,
    })),
  };
}

export class ProviderBase {
  private supportedChatParameters?: ReadonlySet<
    keyof OpenAIChatCompletionsRequestBody
  >;
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
  readonly supportsAiGatewayModels: boolean = true;
  readonly supportsAiGatewayNativeChat: boolean = false;
  readonly requiresAiGateway: boolean = false;
  readonly requiresAuthenticatedAiGateway: boolean = false;
  readonly requiresProviderCredentials: boolean = false;

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

  getAiGatewayApiKeys(): string[] {
    if (this.apiKeyName) {
      return Secrets.getAll(this.apiKeyName, true);
    }
    return [];
  }

  configurationError(): string | undefined {
    return undefined;
  }

  async getNextApiKeyIndex(): Promise<number> {
    const keys = this.getApiKeys();
    if (keys.length <= 1) {
      return 0;
    }

    if (this.apiKeyName) {
      return Secrets.getNext(this.apiKeyName);
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
    preparedData,
    headers,
    apiKeyIndex,
  }: {
    body: string;
    preparedData?: Readonly<Record<string, unknown>>;
    headers: HeadersInit;
    apiKeyIndex?: number;
  }): Promise<[string, RequestInit]> {
    const trimmedData =
      preparedData ??
      this.filterChatCompletionsRequest(
        JSON.parse(body) as Record<string, unknown>,
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

  filterChatCompletionsRequest(
    data: Readonly<Record<string, unknown>>,
  ): Record<string, unknown> {
    this.supportedChatParameters ??= new Set(
      this.CHAT_COMPLETIONS_SUPPORTED_PARAMETERS,
    );

    const filtered: Record<string, unknown> = {};
    for (const key of Object.keys(data)) {
      if (
        this.supportedChatParameters.has(
          key as keyof OpenAIChatCompletionsRequestBody,
        )
      ) {
        filtered[key] = data[key];
      }
    }
    return filtered;
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

  /**
   * Convert a direct-provider path to the provider-native AI Gateway path.
   * Most providers use the same suffix; providers whose Gateway URL embeds
   * region or deployment information can override this hook.
   */
  aiGatewayPath(pathname: string): string {
    return pathname;
  }

  /**
   * Build a provider-native Gateway request when the Compatibility Endpoint
   * cannot represent this provider. Returning undefined leaves chat requests
   * on the direct provider endpoint.
   */
  async buildAiGatewayChatCompletionsRequest(_args: {
    data: Readonly<Record<string, unknown>> & { model: string };
    headers: HeadersInit;
    apiKeyIndex?: number;
  }): Promise<[string, RequestInit] | undefined> {
    return undefined;
  }

  modelsToOpenAIFormat(data: unknown): OpenAIModelsListResponseBody {
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
