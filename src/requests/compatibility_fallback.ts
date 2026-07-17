import { fetchWithLogging } from "../utils/helpers";

export async function fetchCompatibilityFallback(
  requests: [RequestInfo, RequestInit][],
  signal?: AbortSignal,
): Promise<Response> {
  if (requests.length === 0) {
    throw new Error("No AI Gateway compatibility requests were generated.");
  }

  let lastResponse: Response | undefined;
  let lastError: unknown;

  for (const [requestInfo, requestInit] of requests) {
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
