import { Config } from "./config";
import { createHash } from "node:crypto";

const AUTHORIZATION_KEYS = ["Authorization", "x-api-key", "x-goog-api-key"];

const UPSTREAM_CONTROLLED_AUTHORIZATION_HEADERS = new Set([
  ...AUTHORIZATION_KEYS.map((key) => key.toLowerCase()),
  "api-key",
  "proxy-authorization",
  "cookie",
  "host",
  "content-length",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "x-real-ip",
  "true-client-ip",
  "origin",
  "referer",
  "cf-aig-authorization",
]);

const OPERATOR_CONTROLLED_AI_GATEWAY_HEADERS = new Set([
  "cf-aig-authorization",
  // This selects one of the provider credentials stored in AI Gateway BYOK.
  // Treat it as credential policy rather than a request-level tuning control.
  "cf-aig-byok-alias",
  // The cache key partitions Gateway's response cache. Accepting it from a
  // client lets one caller read or poison another caller's cached responses on
  // a shared Gateway, so it is operator-controlled and never client-supplied.
  "cf-aig-cache-key",
]);

/**
 * Returns a copy of request headers without credentials, hop-by-hop fields,
 * or request metadata. AI Gateway request controls can be retained explicitly
 * for requests that are actually routed through AI Gateway.
 */
export function stripProxyAuthorizationHeaders(
  headers: HeadersInit,
  { preserveAiGatewayHeaders = false } = {},
): Headers {
  const sanitizedHeaders = new Headers(headers);
  for (const key of [...sanitizedHeaders.keys()]) {
    const normalizedKey = key.toLowerCase();
    // Gateway authentication and stored-credential selection belong to the
    // operator-controlled configuration. Never accept either from a client,
    // even when request-level Gateway tuning controls are retained.
    if (OPERATOR_CONTROLLED_AI_GATEWAY_HEADERS.has(normalizedKey)) {
      sanitizedHeaders.delete(key);
      continue;
    }
    if (preserveAiGatewayHeaders && normalizedKey.startsWith("cf-aig-")) {
      continue;
    }
    if (
      UPSTREAM_CONTROLLED_AUTHORIZATION_HEADERS.has(normalizedKey) ||
      normalizedKey.startsWith("cf-") ||
      normalizedKey.startsWith("x-forwarded-") ||
      normalizedKey.startsWith("sec-")
    ) {
      sanitizedHeaders.delete(key);
    }
  }
  return sanitizedHeaders;
}

function hashApiKey(apiKey: string): Uint8Array {
  return createHash("sha256").update(apiKey).digest();
}

// Configured keys are stable per deployment and Config.apiKeys() returns a
// memoized array, so their digests are cached by array identity instead of
// being recomputed on every request.
const configuredKeyHashCache = new WeakMap<readonly string[], Uint8Array[]>();

function getConfiguredKeyHashes(configuredKeys: string[]): Uint8Array[] {
  let configuredHashes = configuredKeyHashCache.get(configuredKeys);
  if (!configuredHashes) {
    configuredHashes = configuredKeys.map(hashApiKey);
    configuredKeyHashCache.set(configuredKeys, configuredHashes);
  }
  return configuredHashes;
}

function matchesApiKey(candidate: string, configuredKeys: string[]): boolean {
  const candidateHash = hashApiKey(candidate);
  let matched = false;

  // Compare every configured key so the matching key's position is not exposed
  // through an early return. Hashing also gives timingSafeEqual fixed-size input.
  for (const configuredHash of getConfiguredKeyHashes(configuredKeys)) {
    matched =
      crypto.subtle.timingSafeEqual(candidateHash, configuredHash) || matched;
  }

  return matched;
}

/**
 * Authenticates a request by checking for valid API keys in the request headers.
 *
 * This function verifies if the request contains a valid API key in one of the
 * supported authorization headers. Query-string credentials are intentionally
 * rejected because URLs are commonly retained by access logs and intermediaries.
 *
 * @param request - The incoming request to isRequestAuthorized
 * @returns `true` if the request contains a valid API key, `false` otherwise
 */
export function isRequestAuthorized(
  request: Request,
  configuredApiKeys: string[] | undefined = Config.apiKeys(),
): boolean {
  const apiKeys = configuredApiKeys;
  if (!apiKeys || apiKeys.length === 0) {
    return false;
  }

  const authorizationValue = request.headers.get(AUTHORIZATION_KEYS[0]);
  const apiKey = authorizationValue
    ? (authorizationValue.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null)
    : (
        request.headers.get(AUTHORIZATION_KEYS[1]) ??
        request.headers.get(AUTHORIZATION_KEYS[2])
      )?.trim() || null;

  if (!apiKey) {
    return false;
  }

  return matchesApiKey(apiKey, apiKeys);
}
