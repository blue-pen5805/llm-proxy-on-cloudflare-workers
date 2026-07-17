import { fetchWithLogging } from "../utils/helpers";

export const MAX_COMPATIBILITY_FALLBACK_ATTEMPTS = 4;

function shouldTryAnotherCredential(status: number): boolean {
  return status === 401 || status === 403 || status === 429;
}

export async function fetchCompatibilityFallback(
  requests: [RequestInfo, RequestInit][],
  signal?: AbortSignal,
): Promise<Response> {
  if (requests.length === 0) {
    throw new Error("No AI Gateway compatibility requests were generated.");
  }

  let lastResponse: Response | undefined;
  let lastError: unknown;

  for (const [requestInfo, requestInit] of requests.slice(
    0,
    MAX_COMPATIBILITY_FALLBACK_ATTEMPTS,
  )) {
    if (signal?.aborted) {
      throw signal.reason;
    }

    try {
      const upstreamResponse = await fetchWithLogging(requestInfo, {
        ...requestInit,
        signal,
      });
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
