import { describe, it, expect, vi, beforeEach } from "vitest";
import { CloudflareAIGateway } from "~/src/ai_gateway";
import { MiddlewareContext } from "~/src/middleware";
import { aiGatewayMiddleware } from "~/src/middlewares/ai_gateway";
import { Config } from "~/src/utils/config";

describe("aiGatewayMiddleware", () => {
  let context: MiddlewareContext;
  const next = vi.fn().mockResolvedValue(new Response("ok"));

  beforeEach(() => {
    vi.resetAllMocks();
    context = {
      request: new Request("http://localhost/v1/chat/completions"),
      pathname: "/v1/chat/completions",
    } as MiddlewareContext;
  });

  it("should set AI Gateway from URL if it starts with /g/", async () => {
    vi.spyOn(Config, "aiGateway").mockReturnValue({
      accountId: "test-account",
      name: "default-gateway",
      token: "test-token",
    });

    context.pathname = "/g/my-gateway/v1/chat/completions";

    await aiGatewayMiddleware(context, next);

    expect(context.aiGateway).toBeDefined();
    expect(context.aiGateway instanceof CloudflareAIGateway).toBe(true);
    expect(context.aiGateway?.gatewayId).toBe("my-gateway");
    expect(context.pathname).toBe("/v1/chat/completions");
    expect(next).toHaveBeenCalled();
  });

  it("should set default AI Gateway if accountId and name are configured", async () => {
    vi.spyOn(Config, "aiGateway").mockReturnValue({
      accountId: "test-account",
      name: "default-gateway",
      token: "test-token",
    });

    await aiGatewayMiddleware(context, next);

    expect(context.aiGateway).toBeDefined();
    expect(context.aiGateway?.gatewayId).toBe("default-gateway");
    expect(next).toHaveBeenCalled();
  });

  it("should not set AI Gateway if not configured", async () => {
    vi.spyOn(Config, "aiGateway").mockReturnValue({
      accountId: undefined,
      name: undefined,
      token: undefined,
    });

    await aiGatewayMiddleware(context, next);

    expect(context.aiGateway).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });
});
