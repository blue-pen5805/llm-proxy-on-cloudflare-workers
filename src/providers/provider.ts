import { fetchWithLogging } from "../utils/helpers";
import { Secrets } from "../utils/secrets";
import type {
  InferenceEndpoint,
  PublicInferenceProtocol,
  ResolvedInference,
} from "./inference";
import type { ModelsEndpoint } from "./models";

export type ProviderEndpoints = Partial<
  Record<PublicInferenceProtocol, InferenceEndpoint>
> & {
  readonly models?: ModelsEndpoint;
};

/** The stable interface consumed by request handlers and provider callers. */
export interface Provider {
  resolveInference(
    model: string,
    protocol: PublicInferenceProtocol,
    signal?: AbortSignal,
  ): Promise<ResolvedInference | undefined>;
  readonly credentialProfile: string;
  readonly apiKeyName: keyof Env | undefined;
  readonly baseUrlProp: string;
  readonly pathnamePrefixProp: string;
  readonly endpoints: ProviderEndpoints;
  readonly requiresAiGateway: boolean;
  readonly requiresAuthenticatedAiGateway: boolean;
  readonly requiresProviderCredentials: boolean;
  readonly requiresCustomAiGatewayProvider: boolean;

  available(): boolean;
  getApiKeys(): string[];
  getCredentialProfiles(): string[];
  /** Return Gateway-ready credentials in the same index order as getApiKeys(). */
  getAiGatewayApiKeys(): string[];
  configurationError(): string | undefined;
  getNextApiKeyIndex(): Promise<number>;
  send(url: string, init?: RequestInit): Promise<Response>;
  fetch(
    pathname: string,
    init?: RequestInit,
    apiKeyIndex?: number,
  ): Promise<Response>;
  baseUrl(): string;
  pathnamePrefix(): string;
  /** Credential and provider protocol headers; body format belongs to the operation. */
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
  aiGatewayPath(pathname: string): string;
}

/**
 * Provider-specific values and hooks. Hooks receive the composed provider as
 * `this`, so one hook can reuse another without a base-class dependency.
 */
export interface ProviderDefinition {
  /** Request-scoped resolution for providers with a live protocol catalog. */
  resolveInference?(
    this: Provider,
    model: string,
    protocol: PublicInferenceProtocol,
    signal?: AbortSignal,
  ): Promise<ResolvedInference | undefined>;
  endpoints?: ProviderEndpoints;
  /** Null disables the declared operation for one concrete model. */
  resolveEndpoint?(
    this: Provider,
    model: string,
    protocol: PublicInferenceProtocol,
  ): InferenceEndpoint | null | undefined;
  /** Converts Chat payloads when a requested public operation is unavailable. */
  chatFallback?: InferenceEndpoint;
  resolveChatFallback?(
    this: Provider,
    model: string,
  ): InferenceEndpoint | undefined;
  /** Additional public metadata retained on the composed provider object. */
  properties?: Readonly<Record<string, unknown>>;
  apiKeyName?: keyof Env;
  baseUrl?: string | ((this: Provider) => string);
  pathnamePrefix?: string | ((this: Provider) => string);

  requiresAiGateway?: boolean;
  requiresAuthenticatedAiGateway?: boolean;
  requiresProviderCredentials?: boolean;
  requiresCustomAiGatewayProvider?: boolean;
  openAICompatible?: boolean;
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
  aiGatewayPath?(this: Provider, pathname: string): string;
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

function configuredApiKeys(provider: Provider): string[] {
  if (!provider.apiKeyName) return [];
  return provider.credentialProfile === "default"
    ? Secrets.getAll(provider.apiKeyName)
    : Secrets.getAll(provider.apiKeyName, false, provider.credentialProfile);
}

/** Build one provider by composing common behavior with explicit hooks. */
export function createProvider(definition: ProviderDefinition = {}): Provider {
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
    endpoints: definition.endpoints ?? {},
    requiresAiGateway: definition.requiresAiGateway ?? false,
    requiresAuthenticatedAiGateway:
      definition.requiresAuthenticatedAiGateway ?? false,
    requiresProviderCredentials:
      definition.requiresProviderCredentials ?? false,
    requiresCustomAiGatewayProvider:
      definition.requiresCustomAiGatewayProvider ?? false,
    available() {
      if (definition.available) return definition.available.call(this);
      return this.getApiKeys().length > 0;
    },

    getApiKeys() {
      if (definition.getApiKeys) return definition.getApiKeys.call(this);
      return configuredApiKeys(this);
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
      return configuredApiKeys(this);
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

    send(url, init) {
      return fetchWithLogging(url, init);
    },

    async fetch(pathname, init, apiKeyIndex) {
      if (definition.fetch) {
        return definition.fetch.call(this, pathname, init, apiKeyIndex);
      }
      return this.send(
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

    aiGatewayPath(pathname) {
      return definition.aiGatewayPath
        ? definition.aiGatewayPath.call(this, pathname)
        : pathname;
    },

    async resolveInference(model, protocol, signal) {
      if (definition.resolveInference) {
        return definition.resolveInference.call(this, model, protocol, signal);
      }
      const override = definition.resolveEndpoint?.call(this, model, protocol);
      const endpoint =
        override === null ? undefined : (override ?? this.endpoints[protocol]);
      if (endpoint) return { endpoint, native: true };
      const fallback =
        definition.resolveChatFallback?.call(this, model) ??
        definition.chatFallback ??
        this.endpoints.chat_completions;
      return fallback ? { endpoint: fallback, native: false } : undefined;
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
