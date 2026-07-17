import { fetch2 } from "../utils/helpers";

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
      const response = await fetch2(requestInfo, { ...requestInit, signal });
      if (response.ok) {
        if (lastResponse?.body) {
          await lastResponse.body.cancel();
        }
        return response;
      }

      if (lastResponse?.body) {
        await lastResponse.body.cancel();
      }
      lastResponse = response;
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
