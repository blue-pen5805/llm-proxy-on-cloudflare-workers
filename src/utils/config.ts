import { BUILT_IN_PROVIDER_NAME_SET } from "../providers/names";
import { Environments } from "./environments";
import { ConfigurationError } from "./error";
import { PROVIDER_PROFILE_PATTERN, type ProfiledSecret } from "./secrets";
import {
  exceedsVirtualModelAttemptLimit,
  hasVirtualModelCycle,
  parseVirtualModels,
  VIRTUAL_MODEL_PROVIDER_NAME,
  type VirtualModelCandidate,
  type VirtualModels,
} from "./virtual_models";

export { VIRTUAL_MODEL_PROVIDER_NAME };
export type { VirtualModelCandidate, VirtualModels };

const MAX_CUSTOM_OPENAI_ENDPOINTS = 16;
const MAX_PROXY_API_KEYS = 64;
const DEFAULT_MODELS_CACHE_TTL_SECONDS = 300;
const MAX_MODELS_CACHE_TTL_SECONDS = 86400;
const DEFAULT_STATUS_CACHE_TTL_SECONDS = 0;
const MAX_STATUS_CACHE_TTL_SECONDS = 86400;
const DEFAULT_API_KEY_COOLDOWN_SECONDS = 60;
const MAX_API_KEY_COOLDOWN_SECONDS = 86400;
const MAX_CUSTOM_ENDPOINT_KEYS = 32;
const MAX_PROVIDER_PROFILES = 32;
const MAX_CUSTOM_ENDPOINT_MODELS = 1000;

// The recommended namespace for operator-defined virtual models. "virtual/" is
// only a convention: a virtual model may be keyed by any safe identifier. What
// makes a key resolve as a virtual model is that it does *not* name a real
// provider or Custom OpenAI endpoint — those always take precedence — so a key
// that collides with a real provider is simply shadowed by it. Candidates may
// reference other virtual models; graph validation keeps those references
// acyclic and bounds their expanded attempt count.

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

export interface CustomOpenAIEndpointConfig {
  name: string;
  baseUrl: string;
  apiKeys?: ProfiledSecret;
  models?: string[];
  chatCompletionPath?: string;
  modelsPath?: string;
  responsesPath?: string;
  messagesPath?: string;
}

function isOptionalStringArray(value: unknown): value is string[] | undefined {
  return value === undefined || isStringArray(value);
}

function isValidProfiledSecret(value: unknown): value is ProfiledSecret {
  const isValidKeys = (candidate: unknown): candidate is string | string[] =>
    (typeof candidate === "string" && candidate.trim() !== "") ||
    (isStringArray(candidate) &&
      candidate.length <= MAX_CUSTOM_ENDPOINT_KEYS &&
      candidate.every((key) => key.trim() !== ""));
  if (isValidKeys(value)) return true;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const profiles = Object.entries(value);
  return (
    profiles.length > 0 &&
    profiles.length <= MAX_PROVIDER_PROFILES &&
    profiles.every(
      ([profile, keys]) =>
        PROVIDER_PROFILE_PATTERN.test(profile) && isValidKeys(keys),
    )
  );
}

function isSafeCustomEndpoint(
  value: unknown,
): value is CustomOpenAIEndpointConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const endpoint = value as Record<string, unknown>;
  const allowedProperties = new Set([
    "name",
    "baseUrl",
    "apiKeys",
    "models",
    "chatCompletionPath",
    "modelsPath",
    "responsesPath",
    "messagesPath",
  ]);
  if (
    Object.keys(endpoint).some((key) => !allowedProperties.has(key)) ||
    typeof endpoint.name !== "string" ||
    !/^[A-Za-z0-9._~-]{1,128}$/.test(endpoint.name) ||
    BUILT_IN_PROVIDER_NAME_SET.has(endpoint.name) ||
    typeof endpoint.baseUrl !== "string" ||
    endpoint.baseUrl.length > 2048
  ) {
    return false;
  }

  try {
    const baseUrl = new URL(endpoint.baseUrl);
    if (
      baseUrl.protocol !== "https:" ||
      baseUrl.username ||
      baseUrl.password ||
      baseUrl.search ||
      baseUrl.hash
    ) {
      return false;
    }
  } catch {
    return false;
  }

  const validOptionalPath = (path: unknown): boolean =>
    path === undefined ||
    (typeof path === "string" &&
      path.length <= 2048 &&
      path.startsWith("/") &&
      !path.startsWith("//"));
  const validApiKeys =
    endpoint.apiKeys === undefined || isValidProfiledSecret(endpoint.apiKeys);
  const validModels =
    isOptionalStringArray(endpoint.models) &&
    (endpoint.models === undefined ||
      (endpoint.models.length <= MAX_CUSTOM_ENDPOINT_MODELS &&
        endpoint.models.every((model) => model.trim() !== "")));
  return (
    validApiKeys &&
    validModels &&
    validOptionalPath(endpoint.chatCompletionPath) &&
    validOptionalPath(endpoint.modelsPath) &&
    validOptionalPath(endpoint.responsesPath) &&
    validOptionalPath(endpoint.messagesPath)
  );
}

// Both parsers are pure functions of the raw configured value, so the last
// result is memoized to keep repeated per-request reads off the JSON parser
// and the endpoint validator. A single entry suffices because configuration
// only changes between deployments.
const cachedProxyApiKeys = new WeakMap<
  Env | Partial<Env>,
  string[] | undefined
>();
let cachedCustomEndpointsRaw: unknown;
let cachedCustomEndpoints: CustomOpenAIEndpointConfig[] | undefined;
let cachedVirtualModelsRaw: unknown;
let cachedVirtualModelsCustomEndpointsRaw: unknown;
let cachedVirtualModels: VirtualModels | undefined;

function configuredCustomProviderNames(rawValue: unknown): Set<string> {
  let value: unknown = rawValue;
  if (typeof rawValue === "string") {
    try {
      value = JSON.parse(rawValue) as unknown;
    } catch {
      return new Set();
    }
  }
  if (!Array.isArray(value)) return new Set();
  return new Set(
    value.flatMap((endpoint) =>
      typeof endpoint === "object" &&
      endpoint !== null &&
      typeof (endpoint as { name?: unknown }).name === "string"
        ? [(endpoint as { name: string }).name]
        : [],
    ),
  );
}

function parseProxyApiKeys(rawValue: string): string[] | undefined {
  const trimmedValue = rawValue.trim();

  if (trimmedValue.startsWith("[")) {
    let parsedValue: unknown;
    try {
      parsedValue = JSON.parse(trimmedValue);
    } catch {
      parsedValue = undefined;
    }
    // A well-formed JSON array is the only multi-key format. Anything that
    // parses but is not a string array (or is too long) is a misconfiguration.
    if (parsedValue !== undefined) {
      if (
        !isStringArray(parsedValue) ||
        parsedValue.length > MAX_PROXY_API_KEYS
      ) {
        return undefined;
      }
      return parsedValue.map((key) => key.trim()).filter(Boolean);
    }
    // Not valid JSON: fall through and treat the value as a single key.
  }

  return trimmedValue ? [trimmedValue] : [];
}

/** Read the shared non-negative, capped seconds format used by runtime policies. */
function boundedSeconds(
  key: keyof Env,
  defaultValue: number,
  maximum: number,
): number {
  const trimmedValue = Environments.get(key, false)?.trim();
  if (trimmedValue === undefined || trimmedValue === "") return defaultValue;
  const seconds = Number(trimmedValue);
  return Number.isInteger(seconds) && seconds >= 0
    ? Math.min(seconds, maximum)
    : defaultValue;
}

export class Config {
  static isDevelopment(): boolean {
    // deploy-secrets omits this local-development flag. The auth middleware
    // also checks the runtime before honoring it, including when an operator
    // installs DEV through another deployment path.
    const dev = Environments.get("DEV", false);
    return dev?.trim().toLowerCase() === "true";
  }

  static apiKeys(): string[] | undefined {
    // Read the raw secret without the generic parser so a single key is never
    // split on commas or coerced from a numeric/JSON-looking string. Multiple
    // keys are configured explicitly as a JSON array.
    const rawValue = Environments.get("PROXY_API_KEY", false);

    if (rawValue === undefined) {
      return undefined;
    }

    const environment = Environments.getEnv();
    if (!environment) {
      return parseProxyApiKeys(rawValue);
    }
    if (!cachedProxyApiKeys.has(environment)) {
      cachedProxyApiKeys.set(environment, parseProxyApiKeys(rawValue));
    }
    return cachedProxyApiKeys.get(environment);
  }

  static aiGateway(): {
    accountId: string | undefined;
    name: string | undefined;
    token: string | undefined;
    restApiToken: string | undefined;
    alwaysUse: boolean;
  } {
    const accountId = Environments.get("CLOUDFLARE_ACCOUNT_ID", false);
    const name = Environments.get("AI_GATEWAY_NAME", false);
    const token = Environments.get("CF_AIG_TOKEN", false);
    const restApiToken = Environments.get("CLOUDFLARE_API_TOKEN", false);
    const alwaysUse = Environments.get("ALWAYS_USE_AI_GATEWAY", false);
    return {
      accountId,
      name,
      token,
      restApiToken,
      alwaysUse:
        typeof alwaysUse === "string" &&
        alwaysUse.trim().toLowerCase() === "true",
    };
  }

  static defaultModel(): string | undefined {
    const defaultModel = Environments.get("DEFAULT_MODEL", false);

    return defaultModel;
  }

  /** Whether routed Chat and converted Responses or Messages output receives `llm_proxy`. */
  static chatResponseMetadataEnabled(): boolean {
    const rawValue = Environments.get("CHAT_RESPONSE_METADATA_ENABLED", false);
    return rawValue?.trim().toLowerCase() === "true";
  }

  /**
   * Exact browser origins allowed by CORS. `undefined` preserves the
   * backward-compatible wildcard behavior.
   */
  static allowedOrigins(): string[] | undefined {
    const value = Environments.get("ALLOWED_ORIGINS");
    if (value === undefined || value === null) return undefined;
    if (
      !Array.isArray(value) ||
      value.length > 64 ||
      !value.every((origin) => {
        if (typeof origin !== "string") return false;
        try {
          const url = new URL(origin);
          return (
            (url.protocol === "https:" || url.protocol === "http:") &&
            url.origin === origin
          );
        } catch {
          return false;
        }
      })
    ) {
      throw new ConfigurationError("ALLOWED_ORIGINS");
    }
    return value as string[];
  }

  /**
   * TTL for the aggregated `/models` response cache, in seconds.
   * `0` disables caching. Misconfigured values fall back to the default so a
   * typo never turns the diagnostic fan-out into an uncached hot path.
   */
  static modelsCacheTtlSeconds(): number {
    return boundedSeconds(
      "MODELS_CACHE_TTL_SECONDS",
      DEFAULT_MODELS_CACHE_TTL_SECONDS,
      MAX_MODELS_CACHE_TTL_SECONDS,
    );
  }

  /** Opt-in TTL for the authenticated `/status` diagnostic cache. */
  static statusCacheTtlSeconds(): number {
    return boundedSeconds(
      "STATUS_CACHE_TTL_SECONDS",
      DEFAULT_STATUS_CACHE_TTL_SECONDS,
      MAX_STATUS_CACHE_TTL_SECONDS,
    );
  }

  /**
   * Isolate-local cooldown applied to a provider credential after an upstream
   * status that indicates the credential or provider is temporarily unusable.
   * `0` disables cooldowns.
   */
  static apiKeyCooldownSeconds(): number {
    return boundedSeconds(
      "API_KEY_COOLDOWN_SECONDS",
      DEFAULT_API_KEY_COOLDOWN_SECONDS,
      MAX_API_KEY_COOLDOWN_SECONDS,
    );
  }

  static customOpenAIEndpoints(): CustomOpenAIEndpointConfig[] | undefined {
    const endpoints = Environments.get("CUSTOM_OPENAI_ENDPOINTS", false);

    if (endpoints === undefined || endpoints === null) {
      return undefined;
    }

    if (endpoints === cachedCustomEndpointsRaw) {
      return cachedCustomEndpoints;
    }

    let parsedEndpoints: unknown = endpoints;
    if (typeof endpoints === "string") {
      try {
        parsedEndpoints = JSON.parse(endpoints) as unknown;
      } catch {
        throw new ConfigurationError("CUSTOM_OPENAI_ENDPOINTS");
      }
    }

    if (
      !Array.isArray(parsedEndpoints) ||
      parsedEndpoints.length > MAX_CUSTOM_OPENAI_ENDPOINTS ||
      !parsedEndpoints.every(isSafeCustomEndpoint)
    ) {
      throw new ConfigurationError("CUSTOM_OPENAI_ENDPOINTS");
    }

    const validatedEndpoints = parsedEndpoints as CustomOpenAIEndpointConfig[];
    const endpointNames = validatedEndpoints.map((endpoint) => endpoint.name);
    if (new Set(endpointNames).size !== endpointNames.length) {
      throw new ConfigurationError("CUSTOM_OPENAI_ENDPOINTS");
    }
    // Only validated configurations are memoized; invalid ones keep throwing.
    // The stable array identity also lets the provider registry be reused.
    cachedCustomEndpointsRaw = endpoints;
    cachedCustomEndpoints = validatedEndpoints;
    return validatedEndpoints;
  }

  /**
   * Operator-defined virtual models, keyed by the full request model name
   * (e.g. "virtual/fast-tier", but any safe key works) and valued by an ordered
   * list of "<provider>/<model>" candidates to try in sequence. Real providers
   * take precedence over these keys at request time. `undefined` means no
   * virtual models are configured; a malformed value fails closed with
   * ConfigurationError rather than silently disabling the feature.
   */
  static virtualModels(): VirtualModels | undefined {
    const rawValue = Environments.get("VIRTUAL_MODELS", false);

    if (rawValue === undefined || rawValue === null) {
      return undefined;
    }

    const customEndpointsRaw = Environments.get(
      "CUSTOM_OPENAI_ENDPOINTS",
      false,
    );
    if (
      rawValue === cachedVirtualModelsRaw &&
      customEndpointsRaw === cachedVirtualModelsCustomEndpointsRaw
    ) {
      return cachedVirtualModels;
    }

    let parsedValue: unknown = rawValue;
    if (typeof rawValue === "string") {
      try {
        parsedValue = JSON.parse(rawValue) as unknown;
      } catch {
        throw new ConfigurationError("VIRTUAL_MODELS");
      }
    }

    const virtualModels = parseVirtualModels(parsedValue);
    const realProviderNames = new Set([
      ...BUILT_IN_PROVIDER_NAME_SET,
      ...configuredCustomProviderNames(customEndpointsRaw),
    ]);
    if (
      !virtualModels ||
      hasVirtualModelCycle(virtualModels, realProviderNames)
    ) {
      throw new ConfigurationError("VIRTUAL_MODELS");
    }
    if (exceedsVirtualModelAttemptLimit(virtualModels, realProviderNames)) {
      throw new ConfigurationError("VIRTUAL_MODELS");
    }

    // Only a validated configuration is memoized; invalid ones keep throwing.
    cachedVirtualModelsRaw = rawValue;
    cachedVirtualModelsCustomEndpointsRaw = customEndpointsRaw;
    cachedVirtualModels = virtualModels;
    return cachedVirtualModels;
  }
}
