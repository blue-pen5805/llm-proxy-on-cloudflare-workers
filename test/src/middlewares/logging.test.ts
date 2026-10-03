import { afterEach, describe, expect, it, vi } from "vitest";
import { loggingMiddleware as middleware } from "~/src/middlewares/logging";
import { ProxyRequestState } from "~/src/request_context";
import { RequestLogger } from "~/src/utils/logger";
import { testMiddleware } from "../../helpers/hono";

const loggingMiddleware = testMiddleware(middleware);

describe("loggingMiddleware", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the response unchanged and records request lifecycle", async () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const request = new Request("https://example.com/path?key=secret", {
      method: "POST",
      headers: { "cf-ray": "ray-id" },
    });
    const context = { request } as ProxyRequestState;
    const expected = new Response("ok", { status: 201 });

    const response = await RequestLogger.run(request, () =>
      loggingMiddleware(context, async () => {
        RequestLogger.start({
          endpoint: "chat_completions",
          provider: "openai",
          model: "gpt-4",
        });
        RequestLogger.info("test.provider", "Test provider", {
          provider: "openai",
        });
        return expected;
      }),
    );

    expect(response).toBe(expected);
    expect(consoleInfo).toHaveBeenNthCalledWith(1, {
      event: "request.started",
      request_id: "ray-id",
      method: "POST",
      path: "/path",
      endpoint: "chat_completions",
      provider: "openai",
      model: "gpt-4",
      message:
        "[ray-id] Request started: method=POST, path=/path, endpoint=chat_completions, provider=openai, model=gpt-4",
    });
    expect(consoleInfo).toHaveBeenNthCalledWith(3, {
      event: "request.completed",
      request_id: "ray-id",
      method: "POST",
      path: "/path",
      provider: "openai",
      status: 201,
      duration_ms: expect.any(Number),
      message: expect.stringMatching(
        /^\[ray-id\] Request completed: method=POST, path=\/path, provider=openai, status=201, duration_ms=\d+(?:\.\d+)?$/,
      ),
    });
    expect(JSON.stringify(consoleInfo.mock.calls)).not.toContain("secret");
  });

  it("falls back to method and path when a route has no start metadata", async () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const request = new Request("https://example.com/ping", {
      headers: { "cf-ray": "ray-id" },
    });

    await RequestLogger.run(request, () =>
      loggingMiddleware(
        { request } as ProxyRequestState,
        async () => new Response("ok"),
      ),
    );

    expect(consoleInfo).toHaveBeenNthCalledWith(1, {
      event: "request.started",
      request_id: "ray-id",
      method: "GET",
      path: "/ping",
      message: "[ray-id] Request started: method=GET, path=/ping",
    });
    expect(consoleInfo).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ event: "request.completed", status: 200 }),
    );
  });

  it("does not swallow errors from the wrapped middleware", async () => {
    const error = new Error("failure");
    const request = new Request("https://example.com/");

    await expect(
      RequestLogger.run(request, () =>
        loggingMiddleware({ request } as ProxyRequestState, async () => {
          throw error;
        }),
      ),
    ).rejects.toBe(error);
  });
});
