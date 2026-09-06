import type { VirtualModelCandidate } from "../utils/config";
import { RequestLogger } from "../utils/logger";

export interface ChatCompletionAttemptResult {
  response: Response;
  retryable: boolean;
  nativeProtocol?: boolean;
  route?: import("./chat_response_metadata").ChatResponseRouteMetadata;
}

type ChatCompletionAttempt = (
  candidateModel: string,
  timeout?: number,
) => Promise<ChatCompletionAttemptResult>;

const RETRYABLE_STATUSES = new Set([401, 403, 429]);

/**
 * Statuses worth trying the next candidate for: exhausted or invalid
 * credentials, rate limiting, and upstream server errors. Ordinary 4xx
 * responses (a malformed request, an unknown model) are the client's problem
 * and would fail identically against every candidate, so those are returned
 * as-is instead of masking them behind a later, unrelated failure.
 */
export function isRetryableCandidateStatus(status: number): boolean {
  return RETRYABLE_STATUSES.has(status) || status >= 500;
}

/** Run one upstream fetch with an optional response-header timeout. */
export async function fetchWithCandidateTimeout(
  requestSignal: AbortSignal,
  timeout: number | undefined,
  fetchAttempt: (signal: AbortSignal) => Promise<Response>,
): Promise<Response> {
  requestSignal.throwIfAborted();
  if (timeout === undefined) return fetchAttempt(requestSignal);
  const timeoutController = new AbortController();
  const signal = AbortSignal.any([requestSignal, timeoutController.signal]);
  const timeoutId = setTimeout(
    () =>
      timeoutController.abort(
        new DOMException("Virtual model candidate timed out.", "TimeoutError"),
      ),
    timeout,
  );
  try {
    return await fetchAttempt(signal);
  } finally {
    // Clear the timer as soon as fetch returns response headers so it cannot
    // abort a streaming response body while the caller consumes it.
    clearTimeout(timeoutId);
  }
}

/**
 * Try the candidates of an operator-defined virtual model in order, moving on
 * only when an attempt's response (or thrown error) is retryable and another
 * attempt remains. Each candidate is expanded into `retries + 1` attempts of
 * the same model, so a retryable failure retries the same candidate up to its
 * configured limit before the next candidate is tried. Only one response is
 * ever returned to the caller; every earlier attempt's body is cancelled
 * instead of being read, matching fetchCompatibilityFallback's handling of
 * losing attempts within a single provider.
 */
export async function runVirtualModelChainAttempt(
  virtualModel: string,
  candidates: readonly VirtualModelCandidate[],
  attempt: ChatCompletionAttempt,
  signal?: AbortSignal,
): Promise<ChatCompletionAttemptResult> {
  let totalAttempts = 0;
  for (const candidate of candidates) totalAttempts += candidate.retries + 1;
  let attemptIndex = 0;

  for (const candidate of candidates) {
    for (
      let candidateAttempt = 0;
      candidateAttempt <= candidate.retries;
      candidateAttempt++, attemptIndex++
    ) {
      signal?.throwIfAborted();
      const isLastAttempt = attemptIndex === totalAttempts - 1;
      const logFields = {
        virtual_model: virtualModel,
        candidate: candidate.model,
        attempt: attemptIndex,
        timeout_ms: candidate.timeout,
      };
      RequestLogger.info(
        "virtual_model.select",
        "Virtual model candidate selected for attempt",
        logFields,
      );

      try {
        const result = await (candidate.timeout === undefined
          ? attempt(candidate.model)
          : attempt(candidate.model, candidate.timeout));
        const { response, retryable } = result;

        if (!retryable || isLastAttempt) {
          RequestLogger.info(
            "virtual_model.completed",
            "Virtual model candidate completed",
            {
              ...logFields,
              status: response.status,
            },
          );
          return result;
        }

        RequestLogger.warn(
          "virtual_model.retry",
          "Virtual model candidate failed, trying the next attempt",
          {
            ...logFields,
            status: response.status,
          },
        );
        await response.body?.cancel().catch(() => undefined);
      } catch (error) {
        if (isLastAttempt || signal?.aborted) {
          RequestLogger.error(
            "virtual_model.completed",
            "Virtual model candidate completed with an error",
            error,
            logFields,
          );
          throw error;
        }
        RequestLogger.warn(
          "virtual_model.retry",
          "Virtual model candidate threw, trying the next attempt",
          logFields,
        );
      }
    }
  }

  throw new Error("Virtual model requires at least one candidate.");
}
