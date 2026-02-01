import { describe, it, expect, vi } from "vitest";
import {
  safeJsonParse,
  getPathname,
  shuffleArray,
  formatString,
  maskUrl,
  cleanPathname,
  withTimeout,
} from "~/src/utils/helpers";

describe("safeJsonParse", () => {
  it("should parse valid JSON string", () => {
    const jsonString = '{"key": "value"}';
    const result = safeJsonParse(jsonString);
    expect(result).toEqual({ key: "value" });
  });

  it("should return the original string if JSON is invalid", () => {
    const invalidJsonString = "invalid json";
    const result = safeJsonParse(invalidJsonString);
    expect(result).toBe(invalidJsonString);
  });
});

describe("getPathname", () => {
  it("should return the pathname of the URL", () => {
    const request = new Request("https://example.com/pathname");
    const result = getPathname(request);
    expect(result).toBe("/pathname");
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

describe("formatString", () => {
  it("should format the string with the given arguments", () => {
    const template = "Hello, {name}!";
    const args = { name: "World" };
    const result = formatString(template, args);
    expect(result).toBe("Hello, World!");
  });

  it("should replace multiple occurrences of the same key", () => {
    const template = "{greeting}, {name}! {greeting} again!";
    const args = { greeting: "Hello", name: "World" };
    const result = formatString(template, args);
    expect(result).toBe("Hello, World! Hello again!");
  });
});

describe("maskUrl", () => {
  it("should mask sensitive parameters with long values", () => {
    const url = "https://api.example.com/v1/chat?apiKey=sk-1234567890abcdef";
    const result = maskUrl(url);
    expect(result).toBe("https://api.example.com/v1/chat?apiKey=sk-***");
  });

  it("should mask sensitive parameters with short values", () => {
    const url = "https://api.example.com/v1/chat?key=short";
    const result = maskUrl(url);
    expect(result).toBe("https://api.example.com/v1/chat?key=***");
  });

  it("should not mask non-sensitive parameters", () => {
    const url = "https://api.example.com/v1/chat?model=gpt-4&temperature=0.7";
    const result = maskUrl(url);
    expect(result).toBe(
      "https://api.example.com/v1/chat?model=gpt-4&temperature=0.7",
    );
  });

  it("should mask only sensitive parameters in mixed query strings", () => {
    const url =
      "https://api.example.com/v1/chat?apiKey=sk-1234567890&model=gpt-4&token=abc123456789&temperature=0.7";
    const result = maskUrl(url);
    expect(result).toBe(
      "https://api.example.com/v1/chat?apiKey=sk-***&model=gpt-4&token=abc***&temperature=0.7",
    );
  });

  it("should handle URLs without query parameters", () => {
    const url = "https://api.example.com/v1/chat";
    const result = maskUrl(url);
    expect(result).toBe("https://api.example.com/v1/chat");
  });

  it("should handle invalid URLs gracefully", () => {
    const url = "not a valid url?param=value";
    const result = maskUrl(url);
    expect(result).toBe("not a valid url?***");
  });

  it("should mask various sensitive parameter names", () => {
    const url =
      "https://api.example.com/v1?api_key=key1&access_token=token12345678901&password=pass1&secret=sec1";
    const result = maskUrl(url);
    expect(result).toBe(
      "https://api.example.com/v1?api_key=***&access_token=tok***&password=***&secret=***",
    );
  });
});

describe("cleanPathname", () => {
  it("should return the same pathname if no authorization params", () => {
    const pathname = "/v1/chat/completions";
    const result = cleanPathname(pathname);
    expect(result).toBe("/v1/chat/completions");
  });

  it("should remove authorization query parameters (single)", () => {
    const pathname = "/v1/chat/completions?key=val";
    const result = cleanPathname(pathname);
    expect(result).toBe("/v1/chat/completions");
  });

  it("should remove authorization query parameters (with others)", () => {
    const pathname = "/v1/chat/completions?key=val&model=gpt-4";
    const result = cleanPathname(pathname);
    expect(result).toBe("/v1/chat/completions?model=gpt-4");
  });

  it("should remove authorization query parameters (multiple auth params)", () => {
    // Current only "key" is in AUTHORIZATION_QUERY_PARAMETERS, but test the logic
    const pathname = "/v1/chat/completions?key=val&other=123&key=val2";
    const result = cleanPathname(pathname);
    expect(result).toBe("/v1/chat/completions?other=123");
  });

  it("should clean up invalid query string formats like ?&", () => {
    const pathname = "/v1/chat/completions?&model=gpt-4";
    const result = cleanPathname(pathname);
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
