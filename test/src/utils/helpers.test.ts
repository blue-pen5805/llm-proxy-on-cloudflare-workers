import { describe, it, expect, vi } from "vitest";
import { BadRequestError, PayloadTooLargeError } from "~/src/utils/error";
import {
  parseJsonOrReturnText,
  getRequestPath,
  shuffleArray,
  interpolateTemplate,
  maskSensitiveUrl,
  removeAuthorizationQueryParameters,
  fetchWithLogging,
  readJsonRequest,
  readRequestText,
  readResponseJson,
  withTimeout,
} from "~/src/utils/helpers";
import { RequestLogger } from "~/src/utils/logger";

describe("parseJsonOrReturnText", () => {
  it("should parse valid JSON string", () => {
    const jsonString = '{"key": "value"}';
    const result = parseJsonOrReturnText(jsonString);
    expect(result).toEqual({ key: "value" });
  });

  it("should return the original string if JSON is invalid", () => {
    const invalidJsonString = "invalid json";
    const result = parseJsonOrReturnText(invalidJsonString);
    expect(result).toBe(invalidJsonString);
  });
});

describe("bounded body parsing", () => {
  it("rejects an invalid declared Content-Length", async () => {
    const request = new Request("https://example.com", {
      method: "POST",
      body: "{}",
      headers: { "content-length": "invalid" },
    });
    await expect(readRequestText(request)).rejects.toBeInstanceOf(
      BadRequestError,
    );
  });

  it("rejects an oversized declared request body before reading it", async () => {
    const request = new Request("https://example.com", {
      method: "POST",
      body: "{}",
      headers: { "content-length": "11" },
    });
    await expect(readRequestText(request, 10)).rejects.toBeInstanceOf(
      PayloadTooLargeError,
    );
  });

  it("rejects a streamed body that exceeds the limit", async () => {
    const request = new Request("https://example.com", {
      method: "POST",
      body: "hello",
    });
    await expect(readRequestText(request, 4)).rejects.toBeInstanceOf(
      PayloadTooLargeError,
    );
  });

  it("rejects malformed JSON as a client error", async () => {
    const request = new Request("https://example.com", {
      method: "POST",
      body: "not-json",
    });
    await expect(readJsonRequest(request)).rejects.toBeInstanceOf(
      BadRequestError,
    );
  });

  it("parses bounded upstream JSON", async () => {
    await expect(
      readResponseJson(new Response('{"data":[]}')),
    ).resolves.toEqual({ data: [] });
  });
});

describe("getRequestPath", () => {
  it("should return the pathname of the URL", () => {
    const request = new Request("https://example.com/pathname");
    const result = getRequestPath(request);
    expect(result).toBe("/pathname");
  });

  it("should preserve query parameters", () => {
    const request = new Request("https://example.com/pathname?model=gpt-4");
    expect(getRequestPath(request)).toBe("/pathname?model=gpt-4");
  });
});

describe("shuffleArray", () => {
  it("should shuffle the array", () => {
    const array = [
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
      22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
      40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50,
    ];
    const result = shuffleArray(array);
    expect(result).not.toEqual(array); // It's possible to get the same array, but very unlikely
    expect(result.sort()).toEqual(array.sort()); // Ensure all elements are still present
  });
});

describe("interpolateTemplate", () => {
  it("should format the string with the given arguments", () => {
    const template = "Hello, {name}!";
    const args = { name: "World" };
    const result = interpolateTemplate(template, args);
    expect(result).toBe("Hello, World!");
  });

  it("should replace multiple occurrences of the same key", () => {
    const template = "{greeting}, {name}! {greeting} again!";
    const args = { greeting: "Hello", name: "World" };
    const result = interpolateTemplate(template, args);
    expect(result).toBe("Hello, World! Hello again!");
  });

  it("should replace placeholder keys containing regular expression characters", () => {
    expect(interpolateTemplate("Value: {a.b}", { "a.b": "matched" })).toBe(
      "Value: matched",
    );
  });
});

describe("maskSensitiveUrl", () => {
  it("should mask sensitive parameters with long values", () => {
    const url = "https://api.example.com/v1/chat?apiKey=sk-1234567890abcdef";
    const result = maskSensitiveUrl(url);
    expect(result).toBe("https://api.example.com/v1/chat?apiKey=sk-***");
  });

  it("should mask sensitive parameters with short values", () => {
    const url = "https://api.example.com/v1/chat?key=short";
    const result = maskSensitiveUrl(url);
    expect(result).toBe("https://api.example.com/v1/chat?key=***");
  });

  it("should preserve empty sensitive parameter values", () => {
    const url = "https://api.example.com/v1/chat?key=";
    expect(maskSensitiveUrl(url)).toBe(url);
  });

  it("should not mask non-sensitive parameters", () => {
    const url = "https://api.example.com/v1/chat?model=gpt-4&temperature=0.7";
    const result = maskSensitiveUrl(url);
    expect(result).toBe(
      "https://api.example.com/v1/chat?model=gpt-4&temperature=0.7",
    );
  });

  it("should mask only sensitive parameters in mixed query strings", () => {
    const url =
      "https://api.example.com/v1/chat?apiKey=sk-1234567890&model=gpt-4&token=abc123456789&temperature=0.7";
    const result = maskSensitiveUrl(url);
    expect(result).toBe(
      "https://api.example.com/v1/chat?apiKey=sk-***&model=gpt-4&token=abc***&temperature=0.7",
    );
  });

  it("should handle URLs without query parameters", () => {
    const url = "https://api.example.com/v1/chat";
    const result = maskSensitiveUrl(url);
    expect(result).toBe("https://api.example.com/v1/chat");
  });

  it("should handle invalid URLs gracefully", () => {
    const url = "not a valid url?param=value";
    const result = maskSensitiveUrl(url);
    expect(result).toBe("not a valid url?***");
  });

  it("should handle invalid URLs without a query string", () => {
    expect(maskSensitiveUrl("not a valid url")).toBe("not a valid url");
  });

  it("should mask various sensitive parameter names", () => {
    const url =
      "https://api.example.com/v1?api_key=key1&access_token=token12345678901&password=pass1&secret=sec1";
    const result = maskSensitiveUrl(url);
    expect(result).toBe(
      "https://api.example.com/v1?api_key=***&access_token=tok***&password=***&secret=***",
    );
  });
});

describe("fetchWithLogging", () => {
  it("logs a structured successful subrequest with a masked URL", async () => {
    const response = new Response("ok", { status: 202 });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});

    const result = await RequestLogger.withFields(
      { provider: "openai", key_index: 1 },
      () =>
        fetchWithLogging(
          new Request("https://example.com/models?api_key=private", {
            method: "POST",
          }),
        ),
    );

    expect(result).toBe(response);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(consoleInfo).toHaveBeenCalledWith({
      event: "subrequest.completed",
      request_id: null,
      provider: "openai",
      key_index: 1,
      method: "POST",
      url: "https://example.com/models?api_key=***",
      status: 202,
      duration_ms: expect.any(Number),
    });

    vi.restoreAllMocks();
  });

  it("logs a structured failure and rethrows the original error", async () => {
    const error = new Error("request failed with token=private");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(error);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(
      fetchWithLogging("https://example.com/models?key=private", {
        method: "DELETE",
      }),
    ).rejects.toBe(error);
    expect(consoleError).toHaveBeenCalledWith({
      event: "subrequest.failed",
      request_id: null,
      method: "DELETE",
      url: "https://example.com/models?key=***",
      duration_ms: expect.any(Number),
      error_name: "Error",
      error_message: "request failed with token=***",
    });

    vi.restoreAllMocks();
  });
});

describe("removeAuthorizationQueryParameters", () => {
  it("should return the same pathname if no authorization params", () => {
    const pathname = "/v1/chat/completions";
    const result = removeAuthorizationQueryParameters(pathname);
    expect(result).toBe("/v1/chat/completions");
  });

  it("should remove authorization query parameters (single)", () => {
    const pathname = "/v1/chat/completions?key=val";
    const result = removeAuthorizationQueryParameters(pathname);
    expect(result).toBe("/v1/chat/completions");
  });

  it("should remove authorization query parameters (with others)", () => {
    const pathname = "/v1/chat/completions?key=val&model=gpt-4";
    const result = removeAuthorizationQueryParameters(pathname);
    expect(result).toBe("/v1/chat/completions?model=gpt-4");
  });

  it("should remove authorization query parameters (multiple auth params)", () => {
    const pathname = "/v1/chat/completions?key=val&other=123&key=val2";
    const result = removeAuthorizationQueryParameters(pathname);
    expect(result).toBe("/v1/chat/completions?other=123");
  });

  it("removes case-variant, encoded, and alternate credential parameters", () => {
    const pathname =
      "/v1/chat/completions?%6bey=one&API_KEY=two&access_token=three&model=gpt-4";
    expect(removeAuthorizationQueryParameters(pathname)).toBe(
      "/v1/chat/completions?model=gpt-4",
    );
  });

  it("should clean up invalid query string formats like ?&", () => {
    const pathname = "/v1/chat/completions?&model=gpt-4";
    const result = removeAuthorizationQueryParameters(pathname);
    expect(result).toBe("/v1/chat/completions?model=gpt-4");
  });
});

describe("withTimeout", () => {
  it("should resolve successfully when promise completes before timeout", async () => {
    const abortController = new AbortController();
    const promise = Promise.resolve("success");

    const result = await withTimeout(promise, abortController, 1000, "test");

    expect(result).toBe("success");
    expect(abortController.signal.aborted).toBe(false);
  });

  it("should reject with TimeoutError when promise takes longer than timeout", async () => {
    vi.useFakeTimers();

    try {
      const abortController = new AbortController();
      const hangingPromise = new Promise<string>(() => {}); // Never resolves

      const timeoutPromise = withTimeout(
        hangingPromise,
        abortController,
        1000,
        "test-provider",
      );

      // Advance time past the timeout
      vi.advanceTimersByTime(1000);
      vi.runAllTimers();

      await expect(timeoutPromise).rejects.toThrow(
        "Provider test-provider request timed out",
      );
      expect(abortController.signal.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("should pass through original error when promise rejects before timeout", async () => {
    const abortController = new AbortController();
    const promise = Promise.reject(new Error("Network error"));

    await expect(
      withTimeout(promise, abortController, 1000, "test-provider"),
    ).rejects.toThrow("Network error");
    expect(abortController.signal.aborted).toBe(false);
  });

  it("should clear timeout when promise resolves", async () => {
    vi.useFakeTimers();

    try {
      const abortController = new AbortController();
      const promise = Promise.resolve("success");

      await withTimeout(promise, abortController, 1000, "test");

      // Verify that no timeout callbacks are pending
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
