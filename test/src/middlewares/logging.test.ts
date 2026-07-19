import { afterEach, describe, expect, it, vi } from "vitest";
import { MiddlewareContext } from "~/src/middleware";
import { loggingMiddleware } from "~/src/middlewares/logging";
import { RequestLogger } from "~/src/utils/logger";

describe("loggingMiddleware", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the response unchanged and records request completion", async () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const request = new Request("https://example.com/path?key=secret", {
      method: "POST",
      headers: { "cf-ray": "ray-id" },
    });
    const context = { request } as MiddlewareContext;
    const expected = new Response("ok", { status: 201 });

    const response = await RequestLogger.run(request, () =>
      loggingMiddleware(context, async () => {
        RequestLogger.info("test.provider", "Test provider", {
          provider: "openai",
        });
        return expected;
      }),
    );

    expect(response).toBe(expected);
    expect(consoleInfo).toHaveBeenCalledWith({
      event: "request.completed",
      request_id: "ray-id",
      method: "POST",
      path: "/path",
      provider: "openai",
      status: 201,
      duration_ms: expect.any(Number),
      message: expect.stringMatching(
        /^Request completed: method=POST, path=\/path, provider=openai, status=201, duration_ms=\d+(?:\.\d+)?$/,
      ),
    });
    expect(JSON.stringify(consoleInfo.mock.calls)).not.toContain("secret");
  });

  it("does not swallow errors from the wrapped middleware", async () => {
    const error = new Error("failure");
    const request = new Request("https://example.com/");

    await expect(
      RequestLogger.run(request, () =>
        loggingMiddleware({ request } as MiddlewareContext, async () => {
          throw error;
        }),
      ),
    ).rejects.toBe(error);
  });
});
