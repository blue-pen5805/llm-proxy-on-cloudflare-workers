import { fetchWithLogging } from "../utils/helpers";
import type { LogFields } from "../utils/logger";
import { RequestLogger } from "../utils/logger";

export const MAX_COMPATIBILITY_FALLBACK_ATTEMPTS = 4;

function shouldTryAnotherCredential(status: number): boolean {
  return status === 401 || status === 403 || status === 429;
}

export type GatewayRequestAttempt =
  | [RequestInfo, RequestInit]
  | (() => Promise<[RequestInfo, RequestInit]>);

export async function fetchCompatibilityFallback(
  requests: GatewayRequestAttempt[],
  signal?: AbortSignal,
  beforeAttempt?: (attemptIndex: number) => LogFields,
  afterResponse?: (attemptIndex: number, response: Response) => void,
): Promise<Response> {
  if (requests.length === 0) {
    throw new Error("No AI Gateway compatibility requests were generated.");
  }

  let lastResponse: Response | undefined;
  let lastError: unknown;

  try {
    for (const [attemptIndex, attempt] of requests
      .slice(0, MAX_COMPATIBILITY_FALLBACK_ATTEMPTS)
      .entries()) {
      signal?.throwIfAborted();

      // Only fetch failures trigger credential fallback. Preparation and
      // observer errors are local failures, not evidence of a bad credential.
      const [requestInfo, requestInit] =
        typeof attempt === "function" ? await attempt() : attempt;
      signal?.throwIfAborted();
      const fetchAttempt = () =>
        fetchWithLogging(requestInfo, {
          ...requestInit,
          signal,
        });
      const attemptFields = beforeAttempt?.(attemptIndex);
      let upstreamResponse: Response;
      try {
        upstreamResponse = await (attemptFields
          ? RequestLogger.withFields(attemptFields, fetchAttempt)
          : fetchAttempt());
      } catch (error) {
        if (signal?.aborted) throw error;
        lastError = error;
        continue;
      }

      // Retain the newest response before releasing the previous one. A
      // failed cancellation must not replace this response or retry a request
      // that has already succeeded upstream.
      const previousResponse = lastResponse;
      lastResponse = upstreamResponse;
      await previousResponse?.body?.cancel().catch(() => undefined);
      afterResponse?.(attemptIndex, upstreamResponse);
      if (!shouldTryAnotherCredential(upstreamResponse.status)) {
        return upstreamResponse;
      }
    }

    if (lastResponse) return lastResponse;
    throw lastError;
  } catch (error) {
    // An abort or deterministic preparation/observer error transfers no body
    // to the caller. Release the retained response without masking the cause.
    await lastResponse?.body?.cancel().catch(() => undefined);
    throw error;
  }
}
