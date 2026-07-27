import { describe, it, expect, vi } from "vitest";
import { apiKeyPathMiddleware } from "~/src/middlewares/api_key_path";
import { requestMiddleware } from "~/src/middlewares/request";

describe("apiKeyPathMiddleware", () => {
  it.each([
    ["/key/5/v1/chat/completions", 5, "/v1/chat/completions"],
    [
      "/key/1-3/v1/chat/completions",
      { start: 1, end: 3 },
      "/v1/chat/completions",
    ],
    [
      "/key/2-/v1/chat/completions",
      { start: 2, end: undefined },
      "/v1/chat/completions",
    ],
    [
      "/key/-4/v1/chat/completions",
      { start: undefined, end: 4 },
      "/v1/chat/completions",
    ],
    ["/key/0", 0, "/"],
    ["/v1/chat/completions", undefined, "/v1/chat/completions"],
  ])(
    "extracts the key selection of %s and rewrites the pathname",
    async (urlPath, apiKeyIndex, pathname) => {
      const context: any = {
        request: new Request(`https://example.com${urlPath}`),
      };
      const next = vi.fn();

      await requestMiddleware(context, next);
      await apiKeyPathMiddleware(context, next);

      expect(context.apiKeyIndex).toEqual(apiKeyIndex);
      expect(context.pathname).toBe(pathname);
      expect(next).toHaveBeenCalled();
    },
  );

  it.each([
    "/key/",
    "/key/999999999999999999999999/openai/v1/models",
    "/key/5-2/openai/v1/models",
    "/key/-/openai/v1/models",
    "/key/1evil/openai/v1/models",
  ])("rejects an invalid key selection path: %s", async (urlPath) => {
    const context: any = {
      request: new Request(`https://example.com${urlPath}`),
    };
    const next = vi.fn();
    await requestMiddleware(context, next);
    next.mockClear();

    await expect(apiKeyPathMiddleware(context, next)).rejects.toThrow();
    expect(next).not.toHaveBeenCalled();
  });

  it("preserves query parameters when the key prefix targets root", async () => {
    const context: any = {
      request: new Request("https://example.com/key/1?region=us"),
    };
    const next = vi.fn();
    await requestMiddleware(context, next);
    await apiKeyPathMiddleware(context, next);

    expect(context.pathname).toBe("/?region=us");
  });
});
