import { AUTHORIZATION_QUERY_PARAMETERS } from "./authorization";
import { BadRequestError, PayloadTooLargeError } from "./error";
import { RequestLogger } from "./logger";
import { randomInt } from "node:crypto";

const MASK_THRESHOLD = 10;
const MASK_PREFIX_LENGTH = 3;
const MASK_PLACEHOLDER = "***";
export const MAX_BUFFERED_BODY_BYTES = 10 * 1024 * 1024;
export const MAX_BUFFERED_RESPONSE_BYTES = 5 * 1024 * 1024;
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

export function maskSensitiveUrl(url: string): string {
  try {
    const parsedUrl = new URL(url);

    // Mask only sensitive query parameters
    if (parsedUrl.search) {
      const queryParameters = new URLSearchParams(parsedUrl.search);
      const maskedQueryParameters = new URLSearchParams();

      for (const [parameterName, parameterValue] of queryParameters.entries()) {
        if (SENSITIVE_QUERY_PARAMETERS.has(parameterName.toLowerCase())) {
          maskedQueryParameters.set(
            parameterName,
            maskSensitiveValue(parameterValue),
          );
        } else {
          // Keep non-sensitive parameters as-is
          maskedQueryParameters.set(parameterName, parameterValue);
        }
      }

      parsedUrl.search = maskedQueryParameters.toString();
    }

    return parsedUrl.toString();
  } catch {
    // If URL parsing fails, return masked version
    return (
      url.split("?")[0] + (url.includes("?") ? `?${MASK_PLACEHOLDER}` : "")
    );
  }
}

export async function fetchWithLogging(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const requestUrl = input instanceof Request ? input.url : input.toString();
  const requestMethod =
    init?.method ?? (input instanceof Request ? input.method : "GET");
  const maskedUrl = maskSensitiveUrl(requestUrl);
  const startedAt = performance.now();

  try {
    const upstreamResponse = await fetch(input, init);
    RequestLogger.info("subrequest.completed", {
      method: requestMethod,
      url: maskedUrl,
      status: upstreamResponse.status,
      duration_ms: RequestLogger.durationMs(startedAt),
    });
    return upstreamResponse;
  } catch (error) {
    RequestLogger.error("subrequest.failed", error, {
      method: requestMethod,
      url: maskedUrl,
      duration_ms: RequestLogger.durationMs(startedAt),
    });
    throw error;
  }
}

export function parseJsonOrReturnText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Read a request body without buffering more than the configured limit. */
export async function readRequestText(
  request: Request,
  maximumBytes: number = MAX_BUFFERED_BODY_BYTES,
): Promise<string> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0) {
      throw new BadRequestError("Invalid Content-Length header.");
    }
    if (declaredBytes > maximumBytes) {
      throw new PayloadTooLargeError();
    }
  }

  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maximumBytes) {
        await reader.cancel("request body limit exceeded");
        throw new PayloadTooLargeError();
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export async function readJsonRequest(request: Request): Promise<unknown> {
  const text = await readRequestText(request);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BadRequestError("Request body must be valid JSON.");
  }
}

/** Parse a bounded upstream JSON response used for model discovery. */
export async function readResponseJson(
  response: Response,
  maximumBytes: number = MAX_BUFFERED_RESPONSE_BYTES,
): Promise<unknown> {
  const request = new Request("https://bounded-body.invalid", {
    method: "POST",
    headers: response.headers,
    body: response.body,
  });
  const text = await readRequestText(request, maximumBytes);
  return JSON.parse(text) as unknown;
}

export function getRequestPath(request: Request): string {
  const requestUrl = new URL(request.url);
  return `${requestUrl.pathname}${requestUrl.search}${requestUrl.hash}`;
}

export function shuffleArray<T>(array: T[]): T[] {
  const shuffledArray = [...array];

  for (
    let currentIndex = shuffledArray.length - 1;
    currentIndex > 0;
    currentIndex--
  ) {
    const randomIndex = randomInt(currentIndex + 1);
    [shuffledArray[currentIndex], shuffledArray[randomIndex]] = [
      shuffledArray[randomIndex],
      shuffledArray[currentIndex],
    ];
  }

  return shuffledArray;
}

export function interpolateTemplate(
  template: string,
  templateValues: Record<string, string>,
): string {
  return Object.keys(templateValues).reduce((formattedString, placeholder) => {
    return formattedString.replaceAll(
      `{${placeholder}}`,
      templateValues[placeholder],
    );
  }, template);
}

export function removeAuthorizationQueryParameters(pathname: string): string {
  let cleanedPathname = pathname;

  // Remove authorization query parameters using regex
  AUTHORIZATION_QUERY_PARAMETERS.forEach((parameterName) => {
    // Pattern to match: &key=value or ?key=value
    const authorizationParameterPattern = new RegExp(
      `[?&]${parameterName}=([^&]*)`,
      "g",
    );
    cleanedPathname = cleanedPathname.replace(
      authorizationParameterPattern,
      (matchedParameter, _parameterValue, matchOffset, fullPath) => {
        // If it's the first parameter (?key=value), replace with ? if there are other params
        if (matchedParameter.startsWith("?")) {
          // Find the next parameter after this one
          const nextAmpersand = fullPath.indexOf(
            "&",
            matchOffset + matchedParameter.length,
          );
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
      .then((resolvedValue) => {
        clearTimeout(timeoutId);
        resolve(resolvedValue);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}
