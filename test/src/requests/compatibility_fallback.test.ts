import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchCompatibilityFallback,
  MAX_COMPATIBILITY_FALLBACK_ATTEMPTS,
} from "~/src/requests/compatibility_fallback";
import * as helpers from "~/src/utils/helpers";

vi.mock("~/src/utils/helpers");

describe("fetchCompatibilityFallback", () => {
  const requests: [RequestInfo, RequestInit][] = [
    ["https://gateway.example/compat/chat/completions", { method: "POST" }],
    ["https://gateway.example/compat/chat/completions", { method: "POST" }],
  ];

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns the first successful response", async () => {
    const first = new Response("first");
    vi.mocked(helpers.fetchWithLogging).mockResolvedValue(first);

    await expect(fetchCompatibilityFallback(requests)).resolves.toBe(first);
    expect(helpers.fetchWithLogging).toHaveBeenCalledTimes(1);
  });

  it("tries the next request after an unsuccessful response", async () => {
    const first = new Response("unauthorized", { status: 401 });
    const cancel = vi.spyOn(first.body!, "cancel");
    const second = new Response("second");
    vi.mocked(helpers.fetchWithLogging)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    await expect(fetchCompatibilityFallback(requests)).resolves.toBe(second);
    expect(helpers.fetchWithLogging).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("reports each received response with its attempt index", async () => {
    const afterResponse = vi.fn();
    const first = new Response("limited", { status: 429 });
    const second = new Response("second");
    vi.mocked(helpers.fetchWithLogging)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    await fetchCompatibilityFallback(
      requests,
      undefined,
      undefined,
      afterResponse,
    );

    expect(afterResponse).toHaveBeenNthCalledWith(1, 0, first);
    expect(afterResponse).toHaveBeenNthCalledWith(2, 1, second);
  });

  it("tries the next request after a network error", async () => {
    const second = new Response("second");
    vi.mocked(helpers.fetchWithLogging)
      .mockRejectedValueOnce(new Error("network failure"))
      .mockResolvedValueOnce(second);

    await expect(fetchCompatibilityFallback(requests)).resolves.toBe(second);
  });

  it("rethrows a fetch error when cancellation occurs during the request", async () => {
    const controller = new AbortController();
    const error = new Error("cancelled during fetch");
    vi.mocked(helpers.fetchWithLogging).mockImplementation(async () => {
      controller.abort(error);
      throw error;
    });

    await expect(
      fetchCompatibilityFallback(requests, controller.signal),
    ).rejects.toBe(error);
    expect(helpers.fetchWithLogging).toHaveBeenCalledTimes(1);
  });

  it("throws the final network error when no response is received", async () => {
    const error = new Error("all requests failed");
    vi.mocked(helpers.fetchWithLogging).mockRejectedValue(error);

    await expect(fetchCompatibilityFallback(requests)).rejects.toBe(error);
    expect(helpers.fetchWithLogging).toHaveBeenCalledTimes(2);
  });

  it("returns the final HTTP error when every response is unsuccessful", async () => {
    const finalResponse = new Response("rate limited", { status: 429 });
    vi.mocked(helpers.fetchWithLogging)
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(finalResponse);

    await expect(fetchCompatibilityFallback(requests)).resolves.toBe(
      finalResponse,
    );
  });

  it("does not retry deterministic client errors with another credential", async () => {
    const invalidRequest = new Response("invalid", { status: 400 });
    vi.mocked(helpers.fetchWithLogging).mockResolvedValue(invalidRequest);

    await expect(fetchCompatibilityFallback(requests)).resolves.toBe(
      invalidRequest,
    );
    expect(helpers.fetchWithLogging).toHaveBeenCalledOnce();
  });

  it("cancels a retryable response before returning a deterministic error", async () => {
    const retryable = new Response("unauthorized", { status: 401 });
    const cancel = vi.spyOn(retryable.body!, "cancel");
    const deterministic = new Response("invalid", { status: 400 });
    vi.mocked(helpers.fetchWithLogging)
      .mockResolvedValueOnce(retryable)
      .mockResolvedValueOnce(deterministic);

    await expect(fetchCompatibilityFallback(requests)).resolves.toBe(
      deterministic,
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("caps credential fallback attempts", async () => {
    const manyRequests = Array.from(
      { length: MAX_COMPATIBILITY_FALLBACK_ATTEMPTS + 3 },
      () => requests[0],
    );
    vi.mocked(helpers.fetchWithLogging).mockImplementation(
      async () => new Response("rate limited", { status: 429 }),
    );

    await fetchCompatibilityFallback(manyRequests);
    expect(helpers.fetchWithLogging).toHaveBeenCalledTimes(
      MAX_COMPATIBILITY_FALLBACK_ATTEMPTS,
    );
  });

  it("does not continue after cancellation", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));

    await expect(
      fetchCompatibilityFallback(requests, controller.signal),
    ).rejects.toThrow("cancelled");
    expect(helpers.fetchWithLogging).not.toHaveBeenCalled();
  });

  it("rejects an empty fallback sequence", async () => {
    await expect(fetchCompatibilityFallback([])).rejects.toThrow(
      "No AI Gateway compatibility requests were generated.",
    );
  });

  it.each([200, 400, 429])(
    "keeps the new HTTP %s response when discarding an older body fails",
    async (status) => {
      const first = new Response("unauthorized", { status: 401 });
      const cancel = vi
        .spyOn(first.body!, "cancel")
        .mockRejectedValue(new Error("closed stream"));
      const second = new Response("latest response", { status });
      vi.mocked(helpers.fetchWithLogging)
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(second);

      const result = await fetchCompatibilityFallback(requests);
      expect(result).toBe(second);
      expect(await result.text()).toBe("latest response");
      expect(cancel).toHaveBeenCalledOnce();
      expect(helpers.fetchWithLogging).toHaveBeenCalledTimes(2);
    },
  );

  it("does not send another request after successful fetch and failed cleanup", async () => {
    const first = new Response("unauthorized", { status: 401 });
    vi.spyOn(first.body!, "cancel").mockRejectedValue(
      new Error("closed stream"),
    );
    const success = new Response("success");
    vi.mocked(helpers.fetchWithLogging)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(success)
      .mockResolvedValueOnce(new Response("unexpected extra request"));

    await expect(
      fetchCompatibilityFallback([...requests, requests[0]]),
    ).resolves.toBe(success);
    expect(helpers.fetchWithLogging).toHaveBeenCalledTimes(2);
  });

  it("releases the retained response when the next credential cannot be prepared", async () => {
    const first = new Response("unauthorized", { status: 401 });
    const cancel = vi.spyOn(first.body!, "cancel");
    const failure = new Error("invalid provider configuration");
    const prepare = vi.fn().mockRejectedValue(failure);
    vi.mocked(helpers.fetchWithLogging).mockResolvedValue(first);

    await expect(
      fetchCompatibilityFallback([requests[0], prepare, requests[0]]),
    ).rejects.toBe(failure);
    expect(cancel).toHaveBeenCalledOnce();
    expect(prepare).toHaveBeenCalledOnce();
    expect(helpers.fetchWithLogging).toHaveBeenCalledOnce();
  });

  it("preserves preparation errors even when releasing the retained body fails", async () => {
    const first = new Response("unauthorized", { status: 401 });
    vi.spyOn(first.body!, "cancel").mockRejectedValue(
      new Error("closed stream"),
    );
    const failure = new Error("invalid provider configuration");
    vi.mocked(helpers.fetchWithLogging).mockResolvedValue(first);

    await expect(
      fetchCompatibilityFallback([
        requests[0],
        async () => {
          throw failure;
        },
      ]),
    ).rejects.toBe(failure);
  });

  it("releases the retained response when cancellation stops the next attempt", async () => {
    const controller = new AbortController();
    const first = new Response("unauthorized", { status: 401 });
    const cancel = vi.spyOn(first.body!, "cancel");
    const reason = new Error("client disconnected");
    vi.mocked(helpers.fetchWithLogging).mockResolvedValue(first);

    await expect(
      fetchCompatibilityFallback(requests, controller.signal, undefined, () =>
        controller.abort(reason),
      ),
    ).rejects.toBe(reason);
    expect(cancel).toHaveBeenCalledOnce();
    expect(helpers.fetchWithLogging).toHaveBeenCalledOnce();
  });

  it("does not fetch when cancellation occurs during lazy request preparation", async () => {
    const controller = new AbortController();
    const reason = new Error("client disconnected");
    await expect(
      fetchCompatibilityFallback(
        [
          async () => {
            controller.abort(reason);
            return requests[0];
          },
        ],
        controller.signal,
      ),
    ).rejects.toBe(reason);
    expect(helpers.fetchWithLogging).not.toHaveBeenCalled();
  });

  it("does not retry an outcome callback failure and releases its response", async () => {
    const response = new Response("success");
    const cancel = vi.spyOn(response.body!, "cancel");
    const failure = new Error("outcome callback failed");
    vi.mocked(helpers.fetchWithLogging).mockResolvedValue(response);

    await expect(
      fetchCompatibilityFallback(requests, undefined, undefined, () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(cancel).toHaveBeenCalledOnce();
    expect(helpers.fetchWithLogging).toHaveBeenCalledOnce();
  });

  it("returns the retained HTTP response if subsequent attempts only have network errors", async () => {
    const response = new Response("limited", { status: 429 });
    vi.mocked(helpers.fetchWithLogging)
      .mockResolvedValueOnce(response)
      .mockRejectedValueOnce(new Error("network failure"));
    const result = await fetchCompatibilityFallback(requests);
    expect(result).toBe(response);
    expect(await result.text()).toBe("limited");
  });
});
