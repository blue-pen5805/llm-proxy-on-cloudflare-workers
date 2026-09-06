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

  for (const [attemptIndex, attempt] of requests
    .slice(0, MAX_COMPATIBILITY_FALLBACK_ATTEMPTS)
    .entries()) {
    if (signal?.aborted) {
      throw signal.reason;
    }

    // Request conversion/configuration errors are deterministic and must not
    // trigger credential fallback. Prepare only the credential being attempted.
    const [requestInfo, requestInit] =
      typeof attempt === "function" ? await attempt() : attempt;
    try {
      const fetchAttempt = () =>
        fetchWithLogging(requestInfo, {
          ...requestInit,
          signal,
        });
      const attemptFields = beforeAttempt?.(attemptIndex);
      const upstreamResponse = await (attemptFields
        ? RequestLogger.withFields(attemptFields, fetchAttempt)
        : fetchAttempt());
      afterResponse?.(attemptIndex, upstreamResponse);
      if (upstreamResponse.ok) {
        if (lastResponse?.body) {
          await lastResponse.body.cancel();
        }
        return upstreamResponse;
      }

      if (!shouldTryAnotherCredential(upstreamResponse.status)) {
        if (lastResponse?.body) {
          await lastResponse.body.cancel();
        }
        return upstreamResponse;
      }

      if (lastResponse?.body) {
        await lastResponse.body.cancel();
      }
      lastResponse = upstreamResponse;
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      lastError = error;
    }
  }

  if (lastResponse) {
    return lastResponse;
  }
  throw lastError;
}
