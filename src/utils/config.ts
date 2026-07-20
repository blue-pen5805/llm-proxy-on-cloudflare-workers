import { BUILT_IN_PROVIDER_NAME_SET } from "../providers/names";
import { Environments } from "./environments";
import { ConfigurationError } from "./error";

export const MAX_CUSTOM_OPENAI_ENDPOINTS = 16;
export const MAX_PROXY_API_KEYS = 64;
export const DEFAULT_MODELS_CACHE_TTL_SECONDS = 300;
export const MAX_MODELS_CACHE_TTL_SECONDS = 86400;
export const DEFAULT_API_KEY_COOLDOWN_SECONDS = 60;
export const MAX_API_KEY_COOLDOWN_SECONDS = 86400;
const MAX_CUSTOM_ENDPOINT_KEYS = 32;
const MAX_CUSTOM_ENDPOINT_MODELS = 1000;

// The reserved pseudo-provider namespace for operator-defined virtual models.
// A request model of "virtual/<name>" never resolves to a real provider or
// Custom OpenAI endpoint; it looks up an ordered list of candidate models
// instead. Reserving one flat, non-recursive namespace keeps the resolution
// bounded and observable rather than allowing virtual models that reference
// other virtual models.
export const VIRTUAL_MODEL_PROVIDER_NAME = "virtual";
export const MAX_VIRTUAL_MODELS = 100;
export const MAX_VIRTUAL_MODEL_CANDIDATES = 16;
export const MAX_VIRTUAL_MODEL_CANDIDATE_RETRIES = 5;
export const MAX_VIRTUAL_MODEL_CANDIDATE_TIMEOUT = 300_000;
const VIRTUAL_MODEL_NAME_PATTERN = /^virtual\/[A-Za-z0-9._~-]{1,128}$/;

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

interface CustomOpenAIEndpoint {
  name: string;
  baseUrl: string;
  apiKeys?: string | string[];
  models?: string[];
  chatCompletionPath?: string;
  modelsPath?: string;
}

function isOptionalStringArray(value: unknown): value is string[] | undefined {
  return value === undefined || isStringArray(value);
}

/**
 * One resolved candidate of a virtual model. `retries` is the number of extra
 * attempts against this same candidate (after the first) before moving on to
 * the next candidate; `0` means a single attempt. Bare-string candidates
 * normalize to `retries: 0`.
 */
export interface VirtualModelCandidate {
  model: string;
  retries: number;
  /** Maximum time in milliseconds to wait for response headers. */
  timeout?: number;
}

export type VirtualModels = Readonly<
  Record<string, readonly VirtualModelCandidate[]>
>;

/** A candidate model must be a non-empty "<provider>/<model>" pair that does
 * not itself name the virtual namespace, so a virtual model can never chain
 * into another virtual model. */
function isValidCandidateModel(model: unknown): model is string {
  if (typeof model !== "string") return false;
  const separatorIndex = model.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex === model.length - 1) {
    return false;
  }
  return model.slice(0, separatorIndex) !== VIRTUAL_MODEL_PROVIDER_NAME;
}

/**
 * Validate and normalize one candidate entry. A candidate is either a bare
 * "<provider>/<model>" string or an object `{ model, retries?, timeout? }`.
 * `timeout` is measured in milliseconds. Returns the normalized candidate, or
 * `undefined` when the entry is malformed.
 */
function parseVirtualModelCandidate(
  value: unknown,
): VirtualModelCandidate | undefined {
  if (typeof value === "string") {
    return isValidCandidateModel(value)
      ? { model: value, retries: 0 }
      : undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  const allowedProperties = new Set(["model", "retries", "timeout"]);
  if (
    Object.keys(candidate).some((key) => !allowedProperties.has(key)) ||
    !isValidCandidateModel(candidate.model)
  ) {
    return undefined;
  }
  const retries = candidate.retries ?? 0;
  if (
    typeof retries !== "number" ||
    !Number.isInteger(retries) ||
    retries < 0 ||
    retries > MAX_VIRTUAL_MODEL_CANDIDATE_RETRIES
  ) {
    return undefined;
  }
  const timeout = candidate.timeout;
  if (
    timeout !== undefined &&
    (typeof timeout !== "number" ||
      !Number.isInteger(timeout) ||
      timeout < 1 ||
      timeout > MAX_VIRTUAL_MODEL_CANDIDATE_TIMEOUT)
  ) {
    return undefined;
  }
  return {
    model: candidate.model,
    retries,
    ...(timeout === undefined ? {} : { timeout }),
  };
}

/**
 * Validate and normalize the whole map. Returns the normalized virtual models,
 * or `undefined` when any part is malformed so the caller can fail closed.
 */
function parseVirtualModels(value: unknown): VirtualModels | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const rawMap = value as Record<string, unknown>;
  const virtualModelNames = Object.keys(rawMap);
  if (virtualModelNames.length > MAX_VIRTUAL_MODELS) {
    return undefined;
  }
  const normalized: Record<string, VirtualModelCandidate[]> = {};
  for (const virtualModelName of virtualModelNames) {
    if (!VIRTUAL_MODEL_NAME_PATTERN.test(virtualModelName)) {
      return undefined;
    }
    const rawCandidates = rawMap[virtualModelName];
    if (
      !Array.isArray(rawCandidates) ||
      rawCandidates.length === 0 ||
      rawCandidates.length > MAX_VIRTUAL_MODEL_CANDIDATES
    ) {
      return undefined;
    }
    const candidates: VirtualModelCandidate[] = [];
    for (const rawCandidate of rawCandidates) {
      const candidate = parseVirtualModelCandidate(rawCandidate);
      if (!candidate) {
        return undefined;
      }
      candidates.push(candidate);
    }
    normalized[virtualModelName] = candidates;
  }
  return normalized;
}

function isSafeCustomEndpoint(value: unknown): value is CustomOpenAIEndpoint {
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
    endpoint.apiKeys === undefined ||
    (typeof endpoint.apiKeys === "string" && endpoint.apiKeys.trim() !== "") ||
    (isStringArray(endpoint.apiKeys) &&
      endpoint.apiKeys.length <= MAX_CUSTOM_ENDPOINT_KEYS &&
      endpoint.apiKeys.every((key) => key.trim() !== ""));
  const validModels =
    isOptionalStringArray(endpoint.models) &&
    (endpoint.models === undefined ||
      (endpoint.models.length <= MAX_CUSTOM_ENDPOINT_MODELS &&
        endpoint.models.every((model) => model.trim() !== "")));
  return (
    validApiKeys &&
    validModels &&
    validOptionalPath(endpoint.chatCompletionPath) &&
    validOptionalPath(endpoint.modelsPath)
  );
}

// Both parsers are pure functions of the raw configured value, so the last
// result is memoized to keep repeated per-request reads off the JSON parser
// and the endpoint validator. A single entry suffices because configuration
// only changes between deployments.
let cachedProxyApiKeysRaw: string | undefined;
let cachedProxyApiKeys: string[] | undefined;
let cachedCustomEndpointsRaw: unknown;
let cachedCustomEndpoints: CustomOpenAIEndpoint[] | undefined;
let cachedVirtualModelsRaw: unknown;
let cachedVirtualModels: VirtualModels | undefined;

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

export class Config {
  static isDevelopment(): boolean {
    // DEV is a development-only flag. deploy-secrets never ships it, so a
    // deployed Worker has no DEV binding and this is always false in
    // production. It is enabled only locally via `npm run dev`, whose
    // .dev.vars file carries DEV=true.
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

    if (rawValue !== cachedProxyApiKeysRaw) {
      cachedProxyApiKeys = parseProxyApiKeys(rawValue);
      cachedProxyApiKeysRaw = rawValue;
    }
    return cachedProxyApiKeys;
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

  /**
   * TTL for the aggregated `/models` response cache, in seconds.
   * `0` disables caching. Misconfigured values fall back to the default so a
   * typo never turns the diagnostic fan-out into an uncached hot path.
   */
  static modelsCacheTtlSeconds(): number {
    const rawValue = Environments.get("MODELS_CACHE_TTL_SECONDS", false);
    const trimmedValue = rawValue?.trim();
    if (trimmedValue === undefined || trimmedValue === "") {
      return DEFAULT_MODELS_CACHE_TTL_SECONDS;
    }
    const ttl = Number(trimmedValue);
    if (!Number.isInteger(ttl) || ttl < 0) {
      return DEFAULT_MODELS_CACHE_TTL_SECONDS;
    }
    return Math.min(ttl, MAX_MODELS_CACHE_TTL_SECONDS);
  }

  static isGlobalRoundRobinEnabled(): boolean {
    const enabled = Environments.get("ENABLE_GLOBAL_ROUND_ROBIN", false);
    return enabled === "true";
  }

  /**
   * Isolate-local cooldown applied to a provider credential after an upstream
   * status that indicates the credential or provider is temporarily unusable.
   * `0` disables cooldowns.
   */
  static apiKeyCooldownSeconds(): number {
    const rawValue = Environments.get("API_KEY_COOLDOWN_SECONDS", false);
    const trimmedValue = rawValue?.trim();
    if (trimmedValue === undefined || trimmedValue === "") {
      return DEFAULT_API_KEY_COOLDOWN_SECONDS;
    }
    const seconds = Number(trimmedValue);
    if (!Number.isInteger(seconds) || seconds < 0) {
      return DEFAULT_API_KEY_COOLDOWN_SECONDS;
    }
    return Math.min(seconds, MAX_API_KEY_COOLDOWN_SECONDS);
  }

  static customOpenAIEndpoints():
    | {
        name: string;
        baseUrl: string;
        apiKeys?: string | string[];
        models?: string[];
      }[]
    | undefined {
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

    const validatedEndpoints = parsedEndpoints as CustomOpenAIEndpoint[];
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
   * (e.g. "virtual/fast-tier") and valued by an ordered list of
   * "<provider>/<model>" candidates to try in sequence. `undefined` means no
   * virtual models are configured; a malformed value fails closed with
   * ConfigurationError rather than silently disabling the feature.
   */
  static virtualModels(): VirtualModels | undefined {
    const rawValue = Environments.get("VIRTUAL_MODELS", false);

    if (rawValue === undefined || rawValue === null) {
      return undefined;
    }

    if (rawValue === cachedVirtualModelsRaw) {
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
    if (!virtualModels) {
      throw new ConfigurationError("VIRTUAL_MODELS");
    }

    // Only a validated configuration is memoized; invalid ones keep throwing.
    cachedVirtualModelsRaw = rawValue;
    cachedVirtualModels = virtualModels;
    return cachedVirtualModels;
  }
}
