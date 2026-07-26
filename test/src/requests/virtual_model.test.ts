import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchWithCandidateTimeout,
  isRetryableCandidateStatus,
  runVirtualModelChainAttempt,
} from "~/src/requests/virtual_model";

const runVirtualModelChain = async (
  ...args: Parameters<typeof runVirtualModelChainAttempt>
): Promise<Response> => (await runVirtualModelChainAttempt(...args)).response;

describe("isRetryableCandidateStatus", () => {
  it.each([
    [200, false],
    [400, false],
    [404, false],
    [401, true],
    [403, true],
    [429, true],
    [500, true],
    [503, true],
  ])("maps status %d to retryable=%s", (status, expected) => {
    expect(isRetryableCandidateStatus(status)).toBe(expected);
  });
});

describe("fetchWithCandidateTimeout", () => {
  it("passes through the request signal when timeout is not configured", async () => {
    const requestController = new AbortController();
    const fetchAttempt = vi.fn().mockResolvedValue(new Response("ok"));

    const response = await fetchWithCandidateTimeout(
      requestController.signal,
      undefined,
      fetchAttempt,
    );

    expect(await response.text()).toBe("ok");
    expect(fetchAttempt).toHaveBeenCalledWith(requestController.signal);
  });

  it("aborts a fetch that exceeds its timeout in milliseconds", async () => {
    vi.useFakeTimers();
    try {
      const fetchAttempt = vi.fn(
        (signal: AbortSignal) =>
          new Promise<Response>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
          }),
      );
      const responsePromise = fetchWithCandidateTimeout(
        new AbortController().signal,
        5000,
        fetchAttempt,
      );
      const rejection = expect(responsePromise).rejects.toMatchObject({
        name: "TimeoutError",
        message: "Virtual model candidate timed out.",
      });

      await vi.advanceTimersByTimeAsync(5000);

      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the timeout after response headers arrive", async () => {
    vi.useFakeTimers();
    try {
      let attemptSignal: AbortSignal | undefined;
      const response = await fetchWithCandidateTimeout(
        new AbortController().signal,
        5000,
        (signal) => {
          attemptSignal = signal;
          return Promise.resolve(new Response("stream"));
        },
      );

      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(5000);
      expect(attemptSignal?.aborted).toBe(false);
      expect(await response.text()).toBe("stream");
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves client cancellation while a timeout is configured", async () => {
    vi.useFakeTimers();
    try {
      const requestController = new AbortController();
      const fetchAttempt = (signal: AbortSignal) =>
        new Promise<Response>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      const responsePromise = fetchWithCandidateTimeout(
        requestController.signal,
        5000,
        fetchAttempt,
      );
      const rejection = expect(responsePromise).rejects.toMatchObject({
        name: "AbortError",
      });

      requestController.abort(
        new DOMException("Client aborted.", "AbortError"),
      );

      await rejection;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("runVirtualModelChainAttempt", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the first response when it is not retryable", async () => {
    const attempt = vi.fn().mockResolvedValue({
      response: new Response("ok"),
      retryable: false,
    });

    const response = await runVirtualModelChain(
      "virtual/route",
      [
        { model: "a/1", retries: 0 },
        { model: "a/2", retries: 0 },
      ],
      attempt,
    );

    expect(await response.text()).toBe("ok");
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(attempt).toHaveBeenCalledWith("a/1");
  });

  it("preserves routing metadata from the selected attempt", async () => {
    const route = {
      provider: "openai",
      model: "gpt-4o-mini",
      credentialProfile: "default",
      viaAiGateway: false,
    };

    const result = await runVirtualModelChainAttempt(
      "virtual/route",
      [{ model: "openai/gpt-4o-mini", retries: 0 }],
      async () => ({
        response: new Response("ok"),
        retryable: false,
        route,
      }),
    );

    expect(result.route).toBe(route);
  });

  it("moves to the next candidate when the response is retryable", async () => {
    const events: Record<string, unknown>[] = [];
    vi.spyOn(console, "info").mockImplementation((record) => {
      events.push(record as Record<string, unknown>);
    });
    vi.spyOn(console, "warn").mockImplementation((record) => {
      events.push(record as Record<string, unknown>);
    });
    const attempt = vi
      .fn()
      .mockResolvedValueOnce({
        response: new Response("first", { status: 429 }),
        retryable: true,
      })
      .mockResolvedValueOnce({
        response: new Response("second", { status: 200 }),
        retryable: false,
      });

    const response = await runVirtualModelChain(
      "virtual/route",
      [
        { model: "a/1", retries: 0 },
        { model: "a/2", retries: 0 },
      ],
      attempt,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("second");
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(
      events.map(({ event, candidate, attempt, status }) => ({
        event,
        candidate,
        attempt,
        status,
      })),
    ).toEqual([
      {
        event: "virtual_model.select",
        candidate: "a/1",
        attempt: 0,
        status: undefined,
      },
      {
        event: "virtual_model.retry",
        candidate: "a/1",
        attempt: 0,
        status: 429,
      },
      {
        event: "virtual_model.select",
        candidate: "a/2",
        attempt: 1,
        status: undefined,
      },
      {
        event: "virtual_model.completed",
        candidate: "a/2",
        attempt: 1,
        status: 200,
      },
    ]);
  });

  it("returns the last candidate's response once every candidate is retryable", async () => {
    const attempt = vi.fn().mockResolvedValue({
      response: new Response("still failing", { status: 503 }),
      retryable: true,
    });

    const response = await runVirtualModelChain(
      "virtual/route",
      [
        { model: "a/1", retries: 0 },
        { model: "a/2", retries: 0 },
      ],
      attempt,
    );

    expect(response.status).toBe(503);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("moves to the next candidate when an attempt throws", async () => {
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({
        response: new Response("ok"),
        retryable: false,
      });

    const response = await runVirtualModelChain(
      "virtual/route",
      [
        { model: "a/1", retries: 0 },
        { model: "a/2", retries: 0 },
      ],
      attempt,
    );

    expect(await response.text()).toBe("ok");
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("rethrows when the last candidate's attempt throws", async () => {
    const events: Record<string, unknown>[] = [];
    vi.spyOn(console, "info").mockImplementation((record) => {
      events.push(record as Record<string, unknown>);
    });
    vi.spyOn(console, "warn").mockImplementation((record) => {
      events.push(record as Record<string, unknown>);
    });
    vi.spyOn(console, "error").mockImplementation((record) => {
      events.push(record as Record<string, unknown>);
    });
    const attempt = vi.fn().mockRejectedValue(new Error("network error"));

    await expect(
      runVirtualModelChain(
        "virtual/route",
        [
          { model: "a/1", retries: 0 },
          { model: "a/2", retries: 0 },
        ],
        attempt,
      ),
    ).rejects.toThrow("network error");
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(
      events.map(
        ({ event, candidate, attempt, error_name, error_message }) => ({
          event,
          candidate,
          attempt,
          error_name,
          error_message,
        }),
      ),
    ).toEqual([
      {
        event: "virtual_model.select",
        candidate: "a/1",
        attempt: 0,
        error_name: undefined,
        error_message: undefined,
      },
      {
        event: "virtual_model.retry",
        candidate: "a/1",
        attempt: 0,
        error_name: undefined,
        error_message: undefined,
      },
      {
        event: "virtual_model.select",
        candidate: "a/2",
        attempt: 1,
        error_name: undefined,
        error_message: undefined,
      },
      {
        event: "virtual_model.completed",
        candidate: "a/2",
        attempt: 1,
        error_name: "Error",
        error_message: "network error",
      },
    ]);
  });

  it("cancels the losing response's body before moving on", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const losingResponse = new Response("first", { status: 429 });
    vi.spyOn(losingResponse, "body", "get").mockReturnValue({
      cancel,
    } as unknown as ReadableStream);

    const attempt = vi
      .fn()
      .mockResolvedValueOnce({ response: losingResponse, retryable: true })
      .mockResolvedValueOnce({
        response: new Response("ok"),
        retryable: false,
      });

    await runVirtualModelChain(
      "virtual/route",
      [
        { model: "a/1", retries: 0 },
        { model: "a/2", retries: 0 },
      ],
      attempt,
    );

    expect(cancel).toHaveBeenCalledOnce();
  });

  it("continues when cancelling a losing response body fails", async () => {
    const cancel = vi.fn().mockRejectedValue(new Error("cancel failed"));
    const losingResponse = new Response("first", { status: 429 });
    vi.spyOn(losingResponse, "body", "get").mockReturnValue({
      cancel,
    } as unknown as ReadableStream);
    const attempt = vi
      .fn()
      .mockResolvedValueOnce({ response: losingResponse, retryable: true })
      .mockResolvedValueOnce({
        response: new Response("ok"),
        retryable: false,
      });

    const response = await runVirtualModelChain(
      "virtual/route",
      [
        { model: "a/1", retries: 0 },
        { model: "a/2", retries: 0 },
      ],
      attempt,
    );

    expect(await response.text()).toBe("ok");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects an empty candidate list defensively", async () => {
    await expect(
      runVirtualModelChain("virtual/route", [], vi.fn()),
    ).rejects.toThrow("Virtual model requires at least one candidate.");
  });

  it("retries a candidate before moving to the next candidate", async () => {
    const attempt = vi
      .fn()
      .mockResolvedValueOnce({
        response: new Response("retry", { status: 429 }),
        retryable: true,
      })
      .mockResolvedValueOnce({
        response: new Response("retry again", { status: 503 }),
        retryable: true,
      })
      .mockResolvedValueOnce({
        response: new Response("fallback", { status: 200 }),
        retryable: false,
      });

    const response = await runVirtualModelChain(
      "virtual/route",
      [
        { model: "a/1", retries: 1 },
        { model: "a/2", retries: 0 },
      ],
      attempt,
    );

    expect(await response.text()).toBe("fallback");
    expect(attempt.mock.calls).toEqual([["a/1"], ["a/1"], ["a/2"]]);
  });

  it("passes each candidate timeout to every configured attempt", async () => {
    const attempt = vi.fn().mockResolvedValue({
      response: new Response("retry", { status: 503 }),
      retryable: true,
    });

    await runVirtualModelChain(
      "virtual/route",
      [
        { model: "a/1", retries: 1, timeout: 5000 },
        { model: "a/2", retries: 0 },
      ],
      attempt,
    );

    expect(attempt.mock.calls).toEqual([["a/1", 5000], ["a/1", 5000], ["a/2"]]);
  });

  it("stops retrying the same candidate after a successful retry", async () => {
    const attempt = vi
      .fn()
      .mockResolvedValueOnce({
        response: new Response("retry", { status: 429 }),
        retryable: true,
      })
      .mockResolvedValueOnce({
        response: new Response("ok", { status: 200 }),
        retryable: false,
      });

    const response = await runVirtualModelChain(
      "virtual/route",
      [
        { model: "a/1", retries: 2 },
        { model: "a/2", retries: 0 },
      ],
      attempt,
    );

    expect(await response.text()).toBe("ok");
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(attempt).toHaveBeenNthCalledWith(2, "a/1");
  });
});
