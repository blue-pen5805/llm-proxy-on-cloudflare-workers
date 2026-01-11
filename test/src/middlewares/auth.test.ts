import { describe, it, expect, vi, beforeEach } from "vitest";
import { MiddlewareContext } from "~/src/middleware";
import { authMiddleware } from "~/src/middlewares/auth";
import { Config } from "~/src/utils/config";
import { UnauthorizedError } from "~/src/utils/error";

describe("authMiddleware", () => {
  let context: MiddlewareContext;
  const next = vi.fn().mockResolvedValue(new Response("ok"));

  beforeEach(() => {
    vi.resetAllMocks();
    context = {
      request: new Request("http://localhost/v1/chat/completions"),
      pathname: "",
    } as MiddlewareContext;
  });

  it("should allow request in development mode", async () => {
    vi.spyOn(Config, "isDevelopment").mockReturnValue(true);
    const nextResponse = new Response("ok");
    next.mockResolvedValue(nextResponse);

    const response = await authMiddleware(context, next);

    expect(response).toBe(nextResponse);
    expect(next).toHaveBeenCalled();
  });

  it("should throw UnauthorizedError if authentication fails in non-development mode", async () => {
    vi.spyOn(Config, "isDevelopment").mockReturnValue(false);
    vi.spyOn(Config, "apiKeys").mockReturnValue(["valid-key"]);

    // Request without auth header
    await expect(authMiddleware(context, next)).rejects.toThrow(
      UnauthorizedError,
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("should allow request with valid API key in non-development mode", async () => {
    vi.spyOn(Config, "isDevelopment").mockReturnValue(false);
    vi.spyOn(Config, "apiKeys").mockReturnValue(["valid-key"]);

    context.request = new Request("http://localhost/v1/chat/completions", {
      headers: {
        Authorization: "Bearer valid-key",
      },
    });
    const nextResponse = new Response("ok");
    next.mockResolvedValue(nextResponse);

    const response = await authMiddleware(context, next);

    expect(response).toBe(nextResponse);
    expect(next).toHaveBeenCalled();
  });

  it("should allow request if no API keys are configured", async () => {
    vi.spyOn(Config, "isDevelopment").mockReturnValue(false);
    vi.spyOn(Config, "apiKeys").mockReturnValue(undefined);
    const nextResponse = new Response("ok");
    next.mockResolvedValue(nextResponse);

    const response = await authMiddleware(context, next);

    expect(response).toBe(nextResponse);
    expect(next).toHaveBeenCalled();
  });
});
