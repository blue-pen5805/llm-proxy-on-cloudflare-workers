import { Config } from "./config";

export const AUTHORIZATION_KEYS = [
  "Authorization",
  "x-api-key",
  "x-goog-api-key",
];

export const AUTHORIZATION_QUERY_PARAMETERS = ["key"];

/**
 * Authenticates a request by checking for valid API keys in the request headers.
 *
 * This function verifies if the request contains a valid API key in one of the
 * supported authorization headers. If no API keys are configured in the system,
 * authentication is bypassed (returns true).
 *
 * @param request - The incoming request to authenticate
 * @returns `true` if the request is authenticated (either because it contains a valid
 * API key or because authentication is disabled), `false` otherwise
 */
export function authenticate(request: Request): boolean {
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
    apiKey = authorizationValue.split(/\s/)[1] || authorizationValue;
  } else {
    const url = new URL(request.url);
    const queryKey = AUTHORIZATION_QUERY_PARAMETERS.find((param) => {
      return Boolean(url.searchParams.get(param));
    });
    if (queryKey) {
      apiKey = url.searchParams.get(queryKey);
    }
  }

  if (!apiKey) {
    return false;
  }

  return apiKeys.includes(apiKey);
}
