import { AUTHORIZATION_QUERY_PARAMETERS } from "./authorization";
import { RequestLogger } from "./logger";
import { randomInt } from "node:crypto";

const MASK_THRESHOLD = 10;
const MASK_PREFIX_LENGTH = 3;
const MASK_PLACEHOLDER = "***";
const SENSITIVE_QUERY_PARAMETERS = new Set([
  "apikey",
  "api_key",
  "token",
  "access_token",
  "accesstoken",
  "auth",
  "authorization",
  "password",
  "secret",
  "key",
  "api-key",
]);

function maskSensitiveValue(value: string): string {
  if (value.length > MASK_THRESHOLD) {
    return `${value.slice(0, MASK_PREFIX_LENGTH)}${MASK_PLACEHOLDER}`;
  }
  return value.length > 0 ? MASK_PLACEHOLDER : value;
}

export function maskUrl(url: string): string {
  try {
    const urlObj = new URL(url);

    // Mask only sensitive query parameters
    if (urlObj.search) {
      const params = new URLSearchParams(urlObj.search);
      const maskedParams = new URLSearchParams();

      for (const [key, value] of params.entries()) {
        if (SENSITIVE_QUERY_PARAMETERS.has(key.toLowerCase())) {
          maskedParams.set(key, maskSensitiveValue(value));
        } else {
          // Keep non-sensitive parameters as-is
          maskedParams.set(key, value);
        }
      }

      urlObj.search = maskedParams.toString();
    }

    return urlObj.toString();
  } catch {
    // If URL parsing fails, return masked version
    return (
      url.split("?")[0] + (url.includes("?") ? `?${MASK_PLACEHOLDER}` : "")
    );
  }
}

export async function fetch2(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = input instanceof Request ? input.url : input.toString();
  const method =
    init?.method ?? (input instanceof Request ? input.method : "GET");
  const maskedUrl = maskUrl(url);
  const startedAt = performance.now();

  try {
    const response = await fetch(input, init);
    RequestLogger.info("subrequest.completed", {
      method,
      url: maskedUrl,
      status: response.status,
      duration_ms: RequestLogger.durationMs(startedAt),
    });
    return response;
  } catch (error) {
    RequestLogger.error("subrequest.failed", error, {
      method,
      url: maskedUrl,
      duration_ms: RequestLogger.durationMs(startedAt),
    });
    throw error;
  }
}

export function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function getPathname(request: Request): string {
  const url = new URL(request.url);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function shuffleArray<T>(array: T[]): T[] {
  const cloneArray = [...array];

  for (let i = cloneArray.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [cloneArray[i], cloneArray[j]] = [cloneArray[j], cloneArray[i]];
  }

  return cloneArray;
}

export function formatString(
  template: string,
  args: { [key: string]: string },
): string {
  return Object.keys(args).reduce((formattedString: string, key) => {
    return formattedString.replaceAll(`{${key}}`, args[key]);
  }, template);
}

export function cleanPathname(pathname: string): string {
  let cleanedPathname = pathname;

  // Remove authorization query parameters using regex
  AUTHORIZATION_QUERY_PARAMETERS.forEach((param) => {
    // Pattern to match: &key=value or ?key=value
    const paramPattern = new RegExp(`[?&]${param}=([^&]*)`, "g");
    cleanedPathname = cleanedPathname.replace(
      paramPattern,
      (match, value, offset, str) => {
        // If it's the first parameter (?key=value), replace with ? if there are other params
        if (match.startsWith("?")) {
          // Find the next parameter after this one
          const nextAmpersand = str.indexOf("&", offset + match.length);
          if (nextAmpersand !== -1) {
            return "?";
          } else {
            return "";
          }
        }
        // If it's not the first parameter (&key=value), just remove it
        return "";
      },
    );
  });

  // Clean up any invalid query string formats like ?&param=value
  return cleanedPathname.replace(/\?\&/, "?");
}

/**
 * Wraps a promise with a timeout using a single timer and AbortController.
 * Aborts the fetch request on timeout and rejects immediately with TimeoutError.
 * Ensures the timer is always cleared and the Promise settles within timeoutMs.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  abortController: AbortController,
  timeoutMs: number,
  providerName: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      abortController.abort();
      const timeoutError = new Error(
        `Provider ${providerName} request timed out`,
      );
      timeoutError.name = "TimeoutError";
      reject(timeoutError);
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timeoutId);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}
