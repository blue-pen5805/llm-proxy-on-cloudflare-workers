import { describe, it, expect, vi } from "vitest";
import { apiKeyPathMiddleware } from "~/src/middlewares/api_key_path";
import { requestMiddleware } from "~/src/middlewares/request";

describe("apiKeyPathMiddleware", () => {
  it("should extract single apiKeyIndex and rewrite pathname", async () => {
    const request = new Request(
      "https://example.com/key/5/v1/chat/completions",
    );
    const context: any = { request };
    const next = vi.fn();

    await requestMiddleware(context, next);
    await apiKeyPathMiddleware(context, next);

    expect(context.apiKeyIndex).toBe(5);
    expect(context.pathname).toBe("/v1/chat/completions");
    expect(next).toHaveBeenCalled();
  });

  it("should extract range apiKeyIndex and rewrite pathname", async () => {
    const request = new Request(
      "https://example.com/key/1-3/v1/chat/completions",
    );
    const context: any = { request };
    const next = vi.fn();

    await requestMiddleware(context, next);
    await apiKeyPathMiddleware(context, next);

    expect(context.apiKeyIndex).toEqual({ start: 1, end: 3 });
    expect(context.pathname).toBe("/v1/chat/completions");
  });

  it("should handle unspecified end in range", async () => {
    const request = new Request(
      "https://example.com/key/2-/v1/chat/completions",
    );
    const context: any = { request };
    const next = vi.fn();

    await requestMiddleware(context, next);
    await apiKeyPathMiddleware(context, next);

    expect(context.apiKeyIndex).toEqual({ start: 2, end: undefined });
  });

  it("should handle unspecified start in range", async () => {
    const request = new Request(
      "https://example.com/key/-4/v1/chat/completions",
    );
    const context: any = { request };
    const next = vi.fn();

    await requestMiddleware(context, next);
    await apiKeyPathMiddleware(context, next);

    expect(context.apiKeyIndex).toEqual({ start: undefined, end: 4 });
  });

  it("should handle empty path after rewrite", async () => {
    const request = new Request("https://example.com/key/0/");
    const context: any = { request };
    const next = vi.fn();

    await requestMiddleware(context, next);
    await apiKeyPathMiddleware(context, next);

    expect(context.pathname).toBe("/");
  });

  it("should not set apiKeyIndex if no match", async () => {
    const request = new Request("https://example.com/v1/chat/completions");
    const context: any = { request };
    const next = vi.fn();

    await requestMiddleware(context, next);
    await apiKeyPathMiddleware(context, next);

    expect(context.apiKeyIndex).toBeUndefined();
    expect(context.pathname).toBe("/v1/chat/completions");
  });
});
