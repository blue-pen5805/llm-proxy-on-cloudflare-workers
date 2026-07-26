import { BadRequestError, PayloadTooLargeError } from "./error";
import { RequestLogger } from "./logger";
import { SENSITIVE_CREDENTIAL_NAMES } from "./sensitive_data";
import { randomInt } from "node:crypto";

const MAX_BUFFERED_BODY_BYTES = 10 * 1024 * 1024;
const MAX_BUFFERED_RESPONSE_BYTES = 5 * 1024 * 1024;

export function maskSensitiveUrl(url: string): string {
  // Provider URLs normally arrive as already normalized absolute HTTP(S)
  // strings. Strip query and fragment delimiters with a bounded scan on that
  // hot path; unusual authorities still go through URL for validation and
  // user-info removal.
  const schemeLength = url.startsWith("https://")
    ? 8
    : url.startsWith("http://")
      ? 7
      : 0;
  if (schemeLength > 0 && !url.includes("\\")) {
    let authorityEnd = url.length;
    const pathStart = url.indexOf("/", schemeLength);
    const queryStart = url.indexOf("?", schemeLength);
    const fragmentStart = url.indexOf("#", schemeLength);
    if (pathStart !== -1) authorityEnd = pathStart;
    if (queryStart !== -1 && queryStart < authorityEnd) {
      authorityEnd = queryStart;
    }
    if (fragmentStart !== -1 && fragmentStart < authorityEnd) {
      authorityEnd = fragmentStart;
    }
    const authority = url.slice(schemeLength, authorityEnd);
    if (
      authority.length > 0 &&
      !authority.includes("@") &&
      /^(?:[A-Za-z0-9._-]+|\[[0-9A-Fa-f:.]+\])(?::\d+)?$/.test(authority)
    ) {
      let pathEnd = url.length;
      if (queryStart !== -1) pathEnd = queryStart;
      if (fragmentStart !== -1 && fragmentStart < pathEnd) {
        pathEnd = fragmentStart;
      }
      return url.slice(0, pathEnd);
    }
  }

  try {
    const parsedUrl = new URL(url);
    return `${parsedUrl.origin}${parsedUrl.pathname}`;
  } catch {
    // Do not echo an unparseable, potentially sensitive value into logs.
    return "[invalid-url]";
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

  RequestLogger.start();
  RequestLogger.info("subrequest.started", "Provider subrequest started", {
    method: requestMethod,
    url: maskedUrl,
  });

  try {
    // A new Worker subrequest defaults to `follow`, which forwards every
    // header—including credentials—to a cross-origin redirect destination.
    // Preserve the upstream 3xx response and never follow it automatically.
    const upstreamResponse = await fetch(input, {
      ...init,
      redirect: "manual",
    });
    RequestLogger.info(
      "subrequest.completed",
      "Provider subrequest completed",
      {
        method: requestMethod,
        url: maskedUrl,
        status: upstreamResponse.status,
        duration_ms: RequestLogger.durationMs(startedAt),
      },
    );
    return upstreamResponse;
  } catch (error) {
    RequestLogger.error(
      "subrequest.failed",
      "Provider subrequest failed",
      error,
      {
        method: requestMethod,
        url: maskedUrl,
        duration_ms: RequestLogger.durationMs(startedAt),
      },
    );
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
  // Request.url is already an absolute, runtime-normalized URL.
  const authorityStart = request.url.indexOf("://") + 3;
  const pathStart = request.url.indexOf("/", authorityStart);
  return request.url.slice(pathStart);
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

/**
 * Count the UTF-8 bytes of a string without allocating an encoded copy.
 * Matches TextEncoder output, including 3 bytes for a lone surrogate
 * (encoded as U+FFFD).
 */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code < 0xdc00 && index + 1 < value.length) {
      const nextCode = value.charCodeAt(index + 1);
      if (nextCode >= 0xdc00 && nextCode < 0xe000) {
        bytes += 4;
        index++;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/**
 * Reject a client-controlled proxy path that could climb above the provider or
 * Gateway base URL, or smuggle a new scheme, once it is string-concatenated into
 * the upstream request URL. Only the path portion is validated; the query string
 * is preserved unchanged. `%2e` is folded to `.` because the URL parser treats
 * percent-encoded dot segments as traversal.
 */
export function assertSafeProxyPath(pathname: string): void {
  const pathOnly = pathname.split(/[?#]/, 1)[0];
  if (
    /[\\\u0000-\u001f\u007f]/.test(pathOnly) ||
    /^[a-z][a-z\d+.-]*:/i.test(pathOnly)
  ) {
    throw new BadRequestError("Invalid proxy request path.");
  }
  for (const segment of pathOnly.split("/")) {
    const decodedSegment = segment.replace(/%2e/gi, ".");
    if (decodedSegment === "." || decodedSegment === "..") {
      throw new BadRequestError("Invalid proxy request path.");
    }
  }
}

export function removeAuthorizationQueryParameters(pathname: string): string {
  // Request paths reaching this point are already URL-normalized, so a path
  // without a query string has nothing to remove or re-serialize.
  if (!pathname.includes("?")) {
    return pathname;
  }
  const parsedPath = new URL(pathname, "https://proxy.invalid");
  for (const parameterName of [...parsedPath.searchParams.keys()]) {
    if (SENSITIVE_CREDENTIAL_NAMES.has(parameterName.toLowerCase())) {
      parsedPath.searchParams.delete(parameterName);
    }
  }
  parsedPath.search = parsedPath.searchParams.toString();
  return `${parsedPath.pathname}${parsedPath.search}${parsedPath.hash}`;
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

    void promise
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
