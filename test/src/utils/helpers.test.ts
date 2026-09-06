import { describe, it, expect, vi } from "vitest";
import { BadRequestError, PayloadTooLargeError } from "~/src/utils/error";
import {
  assertSafeProxyPath,
  parseJsonOrReturnText,
  getRequestPath,
  shuffleArray,
  maskSensitiveUrl,
  removeAuthorizationQueryParameters,
  fetchWithLogging,
  readJsonRequest,
  readRequestText,
  readResponseJson,
  utf8ByteLength,
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
  it("rejects an invalid length even when there is no body to release", async () => {
    const request = new Request("https://example.com", {
      headers: { "content-length": "invalid" },
    });
    await expect(readRequestText(request)).rejects.toBeInstanceOf(
      BadRequestError,
    );
  });

  it.each([
    ["invalid", BadRequestError],
    ["-1", BadRequestError],
    ["11", PayloadTooLargeError],
  ] as const)(
    "releases an upstream body rejected by declared Content-Length %s",
    async (contentLength, ErrorClass) => {
      const cancel = vi.fn();
      const response = new Response(new ReadableStream({ cancel }), {
        headers: { "content-length": contentLength },
      });
      await expect(readResponseJson(response, 10)).rejects.toBeInstanceOf(
        ErrorClass,
      );
      expect(cancel).toHaveBeenCalledOnce();
      expect(response.body!.locked).toBe(false);
    },
  );

  it("preserves a declared size error when cancelling the body fails", async () => {
    const response = new Response(
      new ReadableStream({
        cancel() {
          throw new Error("stream cleanup failed");
        },
      }),
      { headers: { "content-length": "11" } },
    );
    await expect(readResponseJson(response, 10)).rejects.toBeInstanceOf(
      PayloadTooLargeError,
    );
  });

  it("preserves the streamed size error when cancelling the reader fails", async () => {
    const request = new Request("https://example.com", {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("too large"));
        },
        cancel() {
          throw new Error("stream cleanup failed");
        },
      }),
    });
    await expect(readRequestText(request, 4)).rejects.toBeInstanceOf(
      PayloadTooLargeError,
    );
    expect(request.body!.locked).toBe(false);
  });

  it("returns an empty string when the request has no body", async () => {
    await expect(
      readRequestText(new Request("https://example.com")),
    ).resolves.toBe("");
  });
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

describe("utf8ByteLength", () => {
  it.each([
    ["", "empty string"],
    ["ascii", "1-byte characters"],
    ["café", "2-byte characters"],
    ["こんにちは", "3-byte characters"],
    ["😀🎉", "4-byte surrogate pairs"],
    ["a😀あé", "mixed widths"],
    ["\ud800a", "lone lead surrogate followed by ASCII"],
    ["\ud800\ue000", "lone lead surrogate followed by a 3-byte character"],
    ["\ud800", "lone lead surrogate at end of string"],
    ["\udc00", "lone trail surrogate"],
  ])("matches TextEncoder byte counts for %j (%s)", (value) => {
    expect(utf8ByteLength(value)).toBe(new TextEncoder().encode(value).length);
  });
});

describe("maskSensitiveUrl", () => {
  // The whole query string is dropped regardless of parameter name, so one
  // table covers credential, customer-content, and empty parameters alike.
  it.each([
    "https://api.example.com/v1/chat",
    "https://api.example.com/v1/chat?apiKey=sk-1234567890abcdef",
    "https://api.example.com/v1/chat?key=short",
    "https://api.example.com/v1/chat?key=",
    "https://api.example.com/v1/chat?model=gpt-4&temperature=0.7",
    "https://api.example.com/v1/chat?apiKey=sk-1234567890&model=gpt-4&token=abc123456789&temperature=0.7",
  ])("keeps only the path of %s", (url) => {
    expect(maskSensitiveUrl(url)).toBe("https://api.example.com/v1/chat");
  });

  it("removes fragments and credentials embedded in URL user info", () => {
    expect(
      maskSensitiveUrl(
        "https://user:password@api.example.com/v1/chat?key=secret#fragment",
      ),
    ).toBe("https://api.example.com/v1/chat");
    expect(maskSensitiveUrl("https://api.example.com/v1/chat#fragment")).toBe(
      "https://api.example.com/v1/chat",
    );
    expect(maskSensitiveUrl("http://localhost:8787/v1/chat?key=secret")).toBe(
      "http://localhost:8787/v1/chat",
    );
    expect(maskSensitiveUrl("https://api.example.com?key=secret")).toBe(
      "https://api.example.com",
    );
    expect(maskSensitiveUrl("https://api.example.com#fragment")).toBe(
      "https://api.example.com",
    );
    expect(maskSensitiveUrl("https://例.jp/v1?key=secret")).toBe(
      "https://xn--fsq.jp/v1",
    );
    expect(maskSensitiveUrl("https://api.example.com\\v1?key=secret")).toBe(
      "https://api.example.com/v1",
    );
  });

  it.each(["not a valid url?param=value", "not a valid url"])(
    "should handle the invalid URL %j gracefully",
    (url) => {
      expect(maskSensitiveUrl(url)).toBe("[invalid-url]");
    },
  );
});

describe("fetchWithLogging", () => {
  it.each([302, 307, 308])(
    "uses manual redirect mode for credentialed HTTP %i responses",
    async (status) => {
      const redirectDestination = "https://redirect.example/collect";
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(null, {
          status,
          headers: { location: redirectDestination },
        }),
      );

      const response = await fetchWithLogging("https://provider.example/chat", {
        method: "POST",
        headers: {
          authorization: "Bearer provider-secret",
          "cf-aig-authorization": "Bearer gateway-secret",
        },
        body: "{}",
      });

      expect(response.status).toBe(status);
      expect(response.headers.get("location")).toBe(redirectDestination);
      expect(fetchSpy).toHaveBeenCalledOnce();
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://provider.example/chat",
        expect.objectContaining({ redirect: "manual" }),
      );
      expect(
        fetchSpy.mock.calls.some(([input]) =>
          String(input).startsWith(redirectDestination),
        ),
      ).toBe(false);

      vi.restoreAllMocks();
    },
  );

  it("logs a structured successful subrequest with a masked URL", async () => {
    const response = new Response("ok", { status: 202 });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});

    const result = await RequestLogger.withFields(
      { provider: "openai", model: "gpt-4", key_index: 1 },
      () =>
        fetchWithLogging(
          new Request("https://example.com/models?api_key=private", {
            method: "POST",
          }),
        ),
    );

    expect(result).toBe(response);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(consoleInfo).toHaveBeenNthCalledWith(1, {
      event: "subrequest.started",
      request_id: null,
      provider: "openai",
      model: "gpt-4",
      key_index: 1,
      method: "POST",
      url: "https://example.com/models",
      message:
        "Provider subrequest started: provider=openai, model=gpt-4, method=POST, url=https://example.com/models",
    });
    expect(consoleInfo).toHaveBeenNthCalledWith(2, {
      event: "subrequest.completed",
      request_id: null,
      provider: "openai",
      model: "gpt-4",
      key_index: 1,
      method: "POST",
      url: "https://example.com/models",
      status: 202,
      duration_ms: expect.any(Number),
      message: expect.stringMatching(
        /^Provider subrequest completed: provider=openai, model=gpt-4, method=POST, url=https:\/\/example\.com\/models, status=202, duration_ms=\d+(?:\.\d+)?$/,
      ),
    });

    vi.restoreAllMocks();
  });

  it("logs a structured failure and rethrows the original error", async () => {
    const error = new Error("request failed with token=private");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(error);
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(
      fetchWithLogging("https://example.com/models?key=private", {
        method: "DELETE",
      }),
    ).rejects.toBe(error);
    expect(consoleInfo).toHaveBeenCalledWith({
      event: "subrequest.started",
      request_id: null,
      method: "DELETE",
      url: "https://example.com/models",
      message:
        "Provider subrequest started: method=DELETE, url=https://example.com/models",
    });
    expect(consoleError).toHaveBeenCalledWith({
      event: "subrequest.failed",
      request_id: null,
      method: "DELETE",
      url: "https://example.com/models",
      duration_ms: expect.any(Number),
      error_name: "Error",
      error_message: "request failed with token=***",
      message: expect.stringMatching(
        /^Provider subrequest failed: method=DELETE, url=https:\/\/example\.com\/models, duration_ms=\d+(?:\.\d+)?, error_name=Error, error_message=request failed with token=\*\*\*$/,
      ),
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
      "/v1/chat/completions?%6bey=one&API_KEY=two&access_token=three&Authorization=four&AUTH=five&password=six&%73ecret=seven&model=gpt-4";
    expect(removeAuthorizationQueryParameters(pathname)).toBe(
      "/v1/chat/completions?model=gpt-4",
    );
  });

  it("should return a path with no credential parameter byte-for-byte", () => {
    for (const pathname of [
      "/v1/chat/completions?&model=gpt-4",
      "/v1beta/models/gemini:generateContent?alt=sse&prompt=a%20b",
      "/openai/v1/files?filter=name%3Da+b&order=desc",
      "/v1/models?",
      "/v1/models?a=1#frag",
    ]) {
      expect(removeAuthorizationQueryParameters(pathname)).toBe(pathname);
    }
  });

  it("should remove a credential parameter without re-encoding the rest", () => {
    expect(
      removeAuthorizationQueryParameters(
        "/v1beta/models?key=secret&prompt=a%20b&q=x+y",
      ),
    ).toBe("/v1beta/models?prompt=a%20b&q=x+y");
    expect(
      removeAuthorizationQueryParameters("/v1/models?&api%5Fkey=secret&a=1"),
    ).toBe("/v1/models?&a=1");
    expect(removeAuthorizationQueryParameters("/v1/models?token=x#frag")).toBe(
      "/v1/models#frag",
    );
    expect(removeAuthorizationQueryParameters("/v1/models?key=x&")).toBe(
      "/v1/models?",
    );
    expect(removeAuthorizationQueryParameters("/v1/models?&key=x")).toBe(
      "/v1/models?",
    );
    expect(removeAuthorizationQueryParameters("/v1/models?key=x&&")).toBe(
      "/v1/models?&",
    );
  });

  it("should compare a malformed parameter name without decoding it", () => {
    expect(
      removeAuthorizationQueryParameters("/v1/models?%E0%A4=1&key=x"),
    ).toBe("/v1/models?%E0%A4=1");
  });

  it("should not resolve dot segments in a path that carries a query", () => {
    expect(
      removeAuthorizationQueryParameters("/openai/v1/%2e%2e/admin?key=x"),
    ).toBe("/openai/v1/%2e%2e/admin");
  });
});

describe("assertSafeProxyPath", () => {
  it("accepts ordinary provider paths and query strings", () => {
    expect(() => assertSafeProxyPath("/v1/chat/completions")).not.toThrow();
    expect(() =>
      assertSafeProxyPath("/v1beta/models/gemini-1.5:generateContent?alt=sse"),
    ).not.toThrow();
    // A dot inside a segment is fine; only whole "." / ".." segments traverse.
    expect(() => assertSafeProxyPath("/v1.0/models")).not.toThrow();
  });

  it("rejects parent-directory traversal segments", () => {
    expect(() => assertSafeProxyPath("/openai/../../secret")).toThrow(
      BadRequestError,
    );
    expect(() => assertSafeProxyPath("/a/./b")).toThrow(BadRequestError);
  });

  it("rejects percent-encoded dot traversal", () => {
    expect(() => assertSafeProxyPath("/openai/%2e%2e/secret")).toThrow(
      BadRequestError,
    );
    expect(() => assertSafeProxyPath("/openai/%2E./secret")).toThrow(
      BadRequestError,
    );
  });

  it("rejects backslashes, control characters, and scheme smuggling", () => {
    expect(() => assertSafeProxyPath("/a\\b")).toThrow(BadRequestError);
    expect(() => assertSafeProxyPath("/a\tb")).toThrow(BadRequestError);
    expect(() => assertSafeProxyPath("https://evil.example/x")).toThrow(
      BadRequestError,
    );
  });

  it("ignores traversal that appears only in the query string", () => {
    expect(() =>
      assertSafeProxyPath("/v1/models?redirect=../../elsewhere"),
    ).not.toThrow();
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
