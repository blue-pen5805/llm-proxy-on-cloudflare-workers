import { Config } from "./config";
import { createHash } from "node:crypto";

export const AUTHORIZATION_KEYS = [
  "Authorization",
  "x-api-key",
  "x-goog-api-key",
];

export const AUTHORIZATION_QUERY_PARAMETERS = ["key"];

/**
 * Returns a copy of request headers without credentials accepted by this
 * proxy. Provider credentials are added separately after this sanitization.
 */
export function stripProxyAuthorizationHeaders(headers: HeadersInit): Headers {
  const sanitizedHeaders = new Headers(headers);
  AUTHORIZATION_KEYS.forEach((key) => sanitizedHeaders.delete(key));
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
 * supported authorization headers. If no API keys are configured in the system,
 * authentication is bypassed (returns true).
 *
 * @param request - The incoming request to isRequestAuthorized
 * @returns `true` if the request is authenticated (either because it contains a valid
 * API key or because authentication is disabled), `false` otherwise
 */
export function isRequestAuthorized(request: Request): boolean {
  const apiKeys = Config.apiKeys();
  if (!apiKeys) {
    return true;
  }

  let apiKey: string | null = null;

  const authorizationKey =
    AUTHORIZATION_KEYS.find((key) => {
      return Boolean(request.headers.get(key));
    }) || "";
  const authorizationValue = request.headers.get(authorizationKey);

  if (authorizationKey && authorizationValue) {
    const authorizationParts = authorizationValue.trim().split(/\s+/);
    apiKey =
      authorizationParts.length > 1
        ? authorizationParts[1]
        : authorizationParts[0];
  } else {
    const requestUrl = new URL(request.url);
    const queryParameterName = AUTHORIZATION_QUERY_PARAMETERS.find(
      (parameterName) => {
        return Boolean(requestUrl.searchParams.get(parameterName));
      },
    );
    if (queryParameterName) {
      apiKey = requestUrl.searchParams.get(queryParameterName);
    }
  }

  if (!apiKey) {
    return false;
  }

  return matchesApiKey(apiKey, apiKeys);
}
