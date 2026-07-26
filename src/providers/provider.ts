import { fetchWithLogging } from "../utils/helpers";
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

export function convertModelsToOpenAIFormatWithMetadata<
  T extends ModelWithMetadata,
>(providerResponse: { data: T[] }): OpenAIModelsListResponseBody {
  return {
    object: "list",
    data: providerResponse.data.map(
      ({ id, object, created, owned_by, ...providerMetadata }) => ({
        id,
        object,
        created,
        owned_by,
        _: providerMetadata,
      }),
    ),
  };
}

const DEFAULT_CHAT_COMPLETIONS_SUPPORTED_PARAMETERS: (keyof OpenAIChatCompletionsRequestBody)[] =
  [
    "messages",
    "model",
    "store",
    "metadata",
    "frequency_penalty",
    "logit_bias",
    "logprobs",
    "top_logprobs",
    "max_tokens",
    "max_completion_tokens",
    "reasoning_effort",
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

interface AiGatewayChatRequestArguments {
  data: Readonly<Record<string, unknown>> & { model: string };
  headers: HeadersInit;
  apiKeyIndex?: number;
}

interface ChatCompletionsRequestArguments {
  body: string;
  preparedData?: Readonly<Record<string, unknown>>;
  headers: HeadersInit;
  apiKeyIndex?: number;
}

/** The stable interface consumed by request handlers and provider callers. */
export interface Provider {
  readonly credentialProfile: string;
  readonly apiKeyName: keyof Env | undefined;
  readonly baseUrlProp: string;
  readonly pathnamePrefixProp: string;
  readonly chatCompletionPath: string;
  readonly modelsPath: string;
  readonly supportsAiGatewayModels: boolean;
  readonly supportsAiGatewayNativeChat: boolean;
  readonly requiresAiGateway: boolean;
  readonly requiresAuthenticatedAiGateway: boolean;
  readonly requiresProviderCredentials: boolean;
  readonly requiresProviderCredentialsForModels: boolean;
  readonly requiresCustomAiGatewayProvider: boolean;
  readonly CHAT_COMPLETIONS_SUPPORTED_PARAMETERS: (keyof OpenAIChatCompletionsRequestBody)[];

  available(): boolean;
  getApiKeys(): string[];
  getCredentialProfiles(): string[];
  /** Return Gateway-ready credentials in the same index order as getApiKeys(). */
  getAiGatewayApiKeys(): string[];
  configurationError(): string | undefined;
  getNextApiKeyIndex(): Promise<number>;
  fetch(
    pathname: string,
    init?: RequestInit,
    apiKeyIndex?: number,
  ): Promise<Response>;
  baseUrl(): string;
  pathnamePrefix(): string;
  headers(apiKeyIndex?: number): Promise<HeadersInit>;
  buildHeadersForPath(
    pathname: string,
    headers?: HeadersInit,
    apiKeyIndex?: number,
  ): Promise<HeadersInit>;
  buildRequest(
    pathname: string,
    init?: RequestInit,
    apiKeyIndex?: number,
  ): Promise<[string, RequestInit]>;
  buildRequestInit(
    init?: RequestInit,
    apiKeyIndex?: number,
  ): Promise<RequestInit>;
  buildChatCompletionsRequest(
    args: ChatCompletionsRequestArguments,
  ): Promise<[string, RequestInit]>;
  transformChatCompletionsResponse(response: Response): Promise<Response>;
  filterSupportedChatParameters(
    data: Readonly<Record<string, unknown>>,
  ): Record<string, unknown>;
  buildModelsRequest(apiKeyIndex?: number): Promise<[string, RequestInit]>;
  aiGatewayPath(pathname: string): string;
  buildAiGatewayChatCompletionsRequest(
    args: AiGatewayChatRequestArguments,
  ): Promise<[string, RequestInit] | undefined>;
  convertModelsToOpenAIFormat(data: unknown): OpenAIModelsListResponseBody;
  getStaticModels(): OpenAIModelsListResponseBody | undefined;
}

/**
 * Provider-specific values and hooks. Hooks receive the composed provider as
 * `this`, so one hook can reuse another without a base-class dependency.
 */
export interface ProviderDefinition {
  /** Additional public metadata retained on the composed provider object. */
  properties?: Readonly<Record<string, unknown>>;
  apiKeyName?: keyof Env;
  baseUrl?: string | ((this: Provider) => string);
  pathnamePrefix?: string | ((this: Provider) => string);
  chatCompletionPath?: string;
  modelsPath?: string;
  supportsAiGatewayModels?: boolean;
  supportsAiGatewayNativeChat?: boolean;
  requiresAiGateway?: boolean;
  requiresAuthenticatedAiGateway?: boolean;
  requiresProviderCredentials?: boolean;
  requiresProviderCredentialsForModels?: boolean;
  requiresCustomAiGatewayProvider?: boolean;
  openAICompatible?: boolean;
  chatCompletionSupportedParameters?: readonly (keyof OpenAIChatCompletionsRequestBody)[];
  available?(this: Provider): boolean;
  getApiKeys?(this: Provider): string[];
  getCredentialProfiles?(this: Provider): string[];
  getAiGatewayApiKeys?(this: Provider): string[];
  configurationError?(this: Provider): string | undefined;
  getNextApiKeyIndex?(this: Provider): Promise<number>;
  fetch?(
    this: Provider,
    pathname: string,
    init?: RequestInit,
    apiKeyIndex?: number,
  ): Promise<Response>;
  headers?(this: Provider, apiKeyIndex?: number): Promise<HeadersInit>;
  buildHeadersForPath?(
    this: Provider,
    pathname: string,
    headers?: HeadersInit,
    apiKeyIndex?: number,
  ): Promise<HeadersInit>;
  buildChatCompletionsRequest?(
    this: Provider,
    args: ChatCompletionsRequestArguments,
  ): Promise<[string, RequestInit]>;
  transformChatCompletionsResponse?(
    this: Provider,
    response: Response,
  ): Promise<Response>;
  buildModelsRequest?(
    this: Provider,
    apiKeyIndex?: number,
  ): Promise<[string, RequestInit]>;
  aiGatewayPath?(this: Provider, pathname: string): string;
  buildAiGatewayChatCompletionsRequest?(
    this: Provider,
    args: AiGatewayChatRequestArguments,
  ): Promise<[string, RequestInit] | undefined>;
  convertModelsToOpenAIFormat?(
    this: Provider,
    data: unknown,
  ): OpenAIModelsListResponseBody;
  getStaticModels?(this: Provider): OpenAIModelsListResponseBody | undefined;
}

export function mergeHeaders(
  baseHeaders: HeadersInit | undefined,
  overridingHeaders: HeadersInit,
): Headers {
  const headers = new Headers(baseHeaders);
  new Headers(overridingHeaders).forEach((value, key) => {
    headers.set(key, value);
  });
  return headers;
}

export type ProviderConstructor<
  Arguments extends unknown[] = [],
  Instance extends Provider = Provider,
> = new (...args: Arguments) => Instance;

const providerBrand = Symbol("provider");
const openAICompatibleBrand = Symbol("openAICompatibleProvider");

function hasBrand(value: unknown, brand: symbol): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[brand] === true
  );
}

/** Build one provider by composing common behavior with explicit hooks. */
export function createProvider(definition: ProviderDefinition = {}): Provider {
  let supportedChatParameters:
    ReadonlySet<keyof OpenAIChatCompletionsRequestBody> | undefined;

  const provider: Provider = {
    ...definition.properties,
    credentialProfile: "default",
    apiKeyName: definition.apiKeyName,
    baseUrlProp:
      typeof definition.baseUrl === "string"
        ? definition.baseUrl
        : "https://example.com",
    pathnamePrefixProp:
      typeof definition.pathnamePrefix === "string"
        ? definition.pathnamePrefix
        : "",
    chatCompletionPath: definition.chatCompletionPath ?? "/chat/completions",
    modelsPath: definition.modelsPath ?? "/models",
    supportsAiGatewayModels: definition.supportsAiGatewayModels ?? true,
    supportsAiGatewayNativeChat:
      definition.supportsAiGatewayNativeChat ?? false,
    requiresAiGateway: definition.requiresAiGateway ?? false,
    requiresAuthenticatedAiGateway:
      definition.requiresAuthenticatedAiGateway ?? false,
    requiresProviderCredentials:
      definition.requiresProviderCredentials ?? false,
    requiresProviderCredentialsForModels:
      definition.requiresProviderCredentialsForModels ?? false,
    requiresCustomAiGatewayProvider:
      definition.requiresCustomAiGatewayProvider ?? false,
    CHAT_COMPLETIONS_SUPPORTED_PARAMETERS:
      definition.chatCompletionSupportedParameters
        ? [...definition.chatCompletionSupportedParameters]
        : [...DEFAULT_CHAT_COMPLETIONS_SUPPORTED_PARAMETERS],

    available() {
      if (definition.available) return definition.available.call(this);
      return this.getApiKeys().length > 0;
    },

    getApiKeys() {
      if (definition.getApiKeys) return definition.getApiKeys.call(this);
      return this.apiKeyName
        ? this.credentialProfile === "default"
          ? Secrets.getAll(this.apiKeyName)
          : Secrets.getAll(this.apiKeyName, false, this.credentialProfile)
        : [];
    },

    getCredentialProfiles() {
      if (definition.getCredentialProfiles) {
        return definition.getCredentialProfiles.call(this);
      }
      return this.apiKeyName ? Secrets.getProfiles(this.apiKeyName) : [];
    },

    getAiGatewayApiKeys() {
      if (definition.getAiGatewayApiKeys) {
        return definition.getAiGatewayApiKeys.call(this);
      }
      return this.apiKeyName
        ? this.credentialProfile === "default"
          ? Secrets.getAll(this.apiKeyName)
          : Secrets.getAll(this.apiKeyName, false, this.credentialProfile)
        : [];
    },

    configurationError() {
      return definition.configurationError?.call(this);
    },

    async getNextApiKeyIndex() {
      if (definition.getNextApiKeyIndex) {
        return definition.getNextApiKeyIndex.call(this);
      }
      const apiKeys = this.getApiKeys();
      if (apiKeys.length <= 1 || !this.apiKeyName) return 0;
      return this.credentialProfile === "default"
        ? Secrets.getNext(this.apiKeyName)
        : Secrets.getNext(this.apiKeyName, this.credentialProfile);
    },

    async fetch(pathname, init, apiKeyIndex) {
      if (definition.fetch) {
        return definition.fetch.call(this, pathname, init, apiKeyIndex);
      }
      return fetchWithLogging(
        ...(await this.buildRequest(pathname, init, apiKeyIndex)),
      );
    },

    baseUrl() {
      return typeof definition.baseUrl === "function"
        ? definition.baseUrl.call(this)
        : this.baseUrlProp;
    },

    pathnamePrefix() {
      return typeof definition.pathnamePrefix === "function"
        ? definition.pathnamePrefix.call(this)
        : this.pathnamePrefixProp;
    },

    async headers(apiKeyIndex) {
      if (definition.headers) {
        return definition.headers.call(this, apiKeyIndex);
      }
      if (!definition.openAICompatible) return {};

      const apiKeys = this.getApiKeys();
      if (apiKeys.length === 0) return {};
      const selectedApiKeyIndex =
        apiKeyIndex !== undefined ? apiKeyIndex % apiKeys.length : 0;
      return {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKeys[selectedApiKeyIndex]}`,
      };
    },

    async buildHeadersForPath(pathname, headers, apiKeyIndex) {
      if (definition.buildHeadersForPath) {
        return definition.buildHeadersForPath.call(
          this,
          pathname,
          headers,
          apiKeyIndex,
        );
      }
      return mergeHeaders(headers, await this.headers(apiKeyIndex));
    },

    async buildRequest(pathname, init, apiKeyIndex) {
      return [
        this.baseUrl() + this.pathnamePrefix() + pathname,
        {
          ...init,
          headers: await this.buildHeadersForPath(
            pathname,
            init?.headers,
            apiKeyIndex,
          ),
        },
      ];
    },

    async buildRequestInit(init, apiKeyIndex) {
      return {
        ...init,
        headers: mergeHeaders(init?.headers, await this.headers(apiKeyIndex)),
      };
    },

    async buildChatCompletionsRequest(args) {
      if (definition.buildChatCompletionsRequest) {
        return definition.buildChatCompletionsRequest.call(this, args);
      }
      const { body, preparedData, headers, apiKeyIndex } = args;
      const trimmedData =
        preparedData ??
        this.filterSupportedChatParameters(
          JSON.parse(body) as Record<string, unknown>,
        );
      return [
        this.chatCompletionPath,
        {
          method: "POST",
          body: JSON.stringify(trimmedData),
          // Provider-computed headers win over caller-supplied ones, matching
          // buildHeadersForPath so credential/routing headers cannot be
          // overridden from a request on any path.
          headers: mergeHeaders(headers, await this.headers(apiKeyIndex)),
        },
      ];
    },

    async transformChatCompletionsResponse(response) {
      return definition.transformChatCompletionsResponse
        ? definition.transformChatCompletionsResponse.call(this, response)
        : response;
    },

    filterSupportedChatParameters(data) {
      supportedChatParameters ??= new Set(
        this.CHAT_COMPLETIONS_SUPPORTED_PARAMETERS,
      );
      const filteredData: Record<string, unknown> = {};
      for (const key in data) {
        if (
          Object.prototype.hasOwnProperty.call(data, key) &&
          supportedChatParameters.has(
            key as keyof OpenAIChatCompletionsRequestBody,
          )
        ) {
          filteredData[key] = data[key];
        }
      }
      return filteredData;
    },

    async buildModelsRequest(apiKeyIndex) {
      if (definition.buildModelsRequest) {
        return definition.buildModelsRequest.call(this, apiKeyIndex);
      }
      return [
        this.modelsPath,
        { method: "GET", headers: await this.headers(apiKeyIndex) },
      ];
    },

    aiGatewayPath(pathname) {
      return definition.aiGatewayPath
        ? definition.aiGatewayPath.call(this, pathname)
        : pathname;
    },

    async buildAiGatewayChatCompletionsRequest(args) {
      return definition.buildAiGatewayChatCompletionsRequest?.call(this, args);
    },

    convertModelsToOpenAIFormat(data) {
      return definition.convertModelsToOpenAIFormat
        ? definition.convertModelsToOpenAIFormat.call(this, data)
        : (data as OpenAIModelsListResponseBody);
    },

    getStaticModels() {
      return definition.getStaticModels?.call(this);
    },
  };

  Object.defineProperty(provider, providerBrand, { value: true });
  if (definition.openAICompatible) {
    Object.defineProperty(provider, openAICompatibleBrand, { value: true });
  }
  return provider;
}

/** Create an immutable provider view whose credential reads use one profile. */
export function withProviderProfile(
  provider: ProviderBase,
  credentialProfile: string,
): ProviderBase {
  if (provider.credentialProfile === credentialProfile) return provider;
  const profiledProvider = Object.create(provider) as ProviderBase;
  Object.defineProperty(profiledProvider, "credentialProfile", {
    value: credentialProfile,
    enumerable: true,
  });
  return profiledProvider;
}

/**
 * Preserve the existing `new ProviderName(...)` interface while constructing
 * plain composed objects instead of a prototype hierarchy.
 */
export function defineProvider<Arguments extends unknown[] = []>(
  definition: ProviderDefinition | ((...args: Arguments) => ProviderDefinition),
  brand: symbol = Symbol("composedProvider"),
): ProviderConstructor<Arguments> {
  class ComposedProvider {
    static [Symbol.hasInstance](value: unknown): boolean {
      return hasBrand(value, brand);
    }

    constructor(...args: Arguments) {
      const resolvedDefinition =
        typeof definition === "function" ? definition(...args) : definition;
      const providerInstance = createProvider(resolvedDefinition);
      Object.defineProperty(providerInstance, brand, { value: true });
      return providerInstance as unknown as ComposedProvider;
    }
  }

  return ComposedProvider as unknown as ProviderConstructor<Arguments>;
}

export type ProviderBase = Provider;
export const ProviderBase = defineProvider({}, providerBrand);

export type OpenAICompatibleProvider = Provider;
export const OpenAICompatibleProvider = defineProvider(
  {
    openAICompatible: true,
  },
  openAICompatibleBrand,
);

export class ProviderNotSupportedError extends Error {}
