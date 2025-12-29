import { describe, it, expect, vi, beforeEach } from "vitest";
import { MiddlewareContext } from "~/src/middleware";
import { envMiddleware } from "~/src/middlewares/env";
import { Environments } from "~/src/utils/environments";

describe("envMiddleware", () => {
  let context: MiddlewareContext;
  const next = vi.fn().mockResolvedValue(new Response("ok"));

  beforeEach(() => {
    vi.resetAllMocks();
    context = {
      request: new Request("http://localhost/"),
      env: { PROXY_API_KEY: "test-key" } as any,
    } as MiddlewareContext;
  });

  it("should set environment and call next", async () => {
    const setEnvSpy = vi.spyOn(Environments, "setEnv");

    await envMiddleware(context, next);

    expect(setEnvSpy).toHaveBeenCalledWith(context.env);
    expect(next).toHaveBeenCalled();
  });
});
