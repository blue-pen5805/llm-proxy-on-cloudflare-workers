import { Config } from "./config";
import { createHash } from "node:crypto";

export const AUTHORIZATION_KEYS = [
  "Authorization",
  "x-api-key",
  "x-goog-api-key",
];

export const AUTHORIZATION_QUERY_PARAMETERS = [
  "key",
  "api-key",
  "api_key",
  "apikey",
  "access_token",
  "token",
];

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
  "origin",
  "referer",
  "cf-aig-authorization",
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

function matchesApiKey(candidate: string, configuredKeys: string[]): boolean {
  const candidateHash = hashApiKey(candidate);
  let matched = false;

  // Compare every configured key so the matching key's position is not exposed
  // through an early return. Hashing also gives timingSafeEqual fixed-size input.
  for (const configuredKey of configuredKeys) {
    matched =
      crypto.subtle.timingSafeEqual(candidateHash, hashApiKey(configuredKey)) ||
      matched;
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
export function isRequestAuthorized(request: Request): boolean {
  const apiKeys = Config.apiKeys();
  if (!apiKeys || apiKeys.length === 0) {
    return false;
  }

  let apiKey: string | null = null;

  const authorizationKey =
    AUTHORIZATION_KEYS.find((key) => {
      return Boolean(request.headers.get(key));
    }) || "";
  const authorizationValue = request.headers.get(authorizationKey);

  if (authorizationKey && authorizationValue) {
    if (authorizationKey.toLowerCase() === "authorization") {
      const bearerMatch = authorizationValue.match(/^Bearer\s+(\S+)$/i);
      apiKey = bearerMatch?.[1] ?? null;
    } else {
      apiKey = authorizationValue.trim();
    }
  }

  if (!apiKey) {
    return false;
  }

  return matchesApiKey(apiKey, apiKeys);
}
