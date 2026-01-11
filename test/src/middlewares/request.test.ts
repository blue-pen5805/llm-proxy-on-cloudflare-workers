import { describe, it, expect, vi } from "vitest";
import { requestMiddleware } from "~/src/middlewares/request";
import { Environments } from "~/src/utils/environments";

vi.mock("~/src/utils/environments");

describe("requestMiddleware", () => {
  it("should initialize context.pathname and set environment", async () => {
    const request = new Request("https://example.com/v1/chat/completions");
    const env = { TEST: "value" } as any;
    const context: any = { request, env };
    const next = vi.fn();

    await requestMiddleware(context, next);

    expect(context.pathname).toBe("/v1/chat/completions");
    expect(Environments.setEnv).toHaveBeenCalledWith(env);
    expect(next).toHaveBeenCalled();
  });
});
