import { describe, it, expect, vi } from "vitest";
import { requestMiddleware as middleware } from "~/src/middlewares/request";
import { testMiddleware } from "../../helpers/hono";

const requestMiddleware = testMiddleware(middleware);

describe("requestMiddleware", () => {
  it("should initialize context.pathname", async () => {
    const request = new Request("https://example.com/v1/chat/completions");
    const env = { TEST: "value" } as any;
    const context: any = { request, env };
    const next = vi.fn();

    await requestMiddleware(context, next);

    expect(context.pathname).toBe("/v1/chat/completions");
    expect(next).toHaveBeenCalled();
  });
});
