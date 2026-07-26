import { describe, it, expect, vi, beforeEach } from "vitest";
import { MiddlewareContext } from "~/src/middleware";
import { authMiddleware } from "~/src/middlewares/auth";
import { Config } from "~/src/utils/config";
import { ServiceUnavailableError, UnauthorizedError } from "~/src/utils/error";

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

  it("should enforce authentication when DEV is set on a deployed Worker", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(Config, "isDevelopment").mockReturnValue(true);
    vi.spyOn(Config, "apiKeys").mockReturnValue(["valid-key"]);
    // cf-ray is present on every request that reaches a deployed Worker.
    context.request = new Request("https://proxy.example/v1/chat/completions", {
      headers: { "cf-ray": "8f0b1a2c3d4e5f60-NRT" },
    });

    await expect(authMiddleware(context, next)).rejects.toThrow(
      UnauthorizedError,
    );
    expect(next).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "auth.development_mode_ignored" }),
    );
  });

  it("should accept a valid key when DEV is set on a deployed Worker", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(Config, "isDevelopment").mockReturnValue(true);
    vi.spyOn(Config, "apiKeys").mockReturnValue(["valid-key"]);
    context.request = new Request("https://proxy.example/v1/chat/completions", {
      headers: {
        "cf-ray": "8f0b1a2c3d4e5f60-NRT",
        Authorization: "Bearer valid-key",
      },
    });
    const nextResponse = new Response("ok");
    next.mockResolvedValue(nextResponse);

    await expect(authMiddleware(context, next)).resolves.toBe(nextResponse);
  });

  it("should fail closed if no API keys are configured", async () => {
    vi.spyOn(Config, "isDevelopment").mockReturnValue(false);
    vi.spyOn(Config, "apiKeys").mockReturnValue(undefined);
    await expect(authMiddleware(context, next)).rejects.toThrow(
      ServiceUnavailableError,
    );
    expect(next).not.toHaveBeenCalled();
  });
});
