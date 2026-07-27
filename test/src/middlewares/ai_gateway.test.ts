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
      restApiToken: "rest-token",
      alwaysUse: false,
    });

    context.pathname = "/g/my-gateway/v1/chat/completions";

    await aiGatewayMiddleware(context, next);

    expect(context.aiGateway).toBeDefined();
    expect(context.aiGateway instanceof CloudflareAIGateway).toBe(true);
    expect(context.aiGateway?.gatewayId).toBe("my-gateway");
    expect(context.aiGateway?.restApiToken).toBe("rest-token");
    expect(context.pathname).toBe("/v1/chat/completions");
    expect(next).toHaveBeenCalled();
  });

  it("should set default AI Gateway if accountId and name are configured", async () => {
    vi.spyOn(Config, "aiGateway").mockReturnValue({
      accountId: "test-account",
      name: "default-gateway",
      token: "test-token",
      restApiToken: "rest-token",
      alwaysUse: false,
    });

    await aiGatewayMiddleware(context, next);

    expect(context.aiGateway).toBeDefined();
    expect(context.aiGateway?.gatewayId).toBe("default-gateway");
    expect(next).toHaveBeenCalled();
  });

  it("should use the default REST gateway without AI_GATEWAY_NAME", async () => {
    vi.spyOn(Config, "aiGateway").mockReturnValue({
      accountId: "test-account",
      name: undefined,
      token: undefined,
      restApiToken: "rest-token",
      alwaysUse: false,
    });
    context.pathname = "/ai/v1/responses";

    await aiGatewayMiddleware(context, next);

    expect(context.aiGateway).toBeDefined();
    expect(context.aiGateway?.gatewayId).toBe("default");
    expect(context.aiGateway?.restApiToken).toBe("rest-token");
    expect(next).toHaveBeenCalled();
  });

  it("uses the default Gateway for every route in strict mode", async () => {
    vi.spyOn(Config, "aiGateway").mockReturnValue({
      accountId: "test-account",
      name: undefined,
      token: "test-token",
      restApiToken: "rest-token",
      alwaysUse: true,
    });

    await aiGatewayMiddleware(context, next);

    expect(context.aiGateway?.gatewayId).toBe("default");
    expect(context.aiGateway?.alwaysUse).toBe(true);
    expect(next).toHaveBeenCalled();
  });

  it("fails closed when strict mode has no account ID", async () => {
    vi.spyOn(Config, "aiGateway").mockReturnValue({
      accountId: undefined,
      name: undefined,
      token: undefined,
      restApiToken: undefined,
      alwaysUse: true,
    });

    await expect(aiGatewayMiddleware(context, next)).rejects.toThrow(
      "Invalid configuration for ALWAYS_USE_AI_GATEWAY",
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("explains a /g route that has no account ID", async () => {
    vi.spyOn(Config, "aiGateway").mockReturnValue({
      accountId: undefined,
      name: undefined,
      token: undefined,
      restApiToken: undefined,
      alwaysUse: false,
    });
    context.pathname = "/g/team/v1/models";

    await expect(aiGatewayMiddleware(context, next)).rejects.toThrow(
      "AI Gateway routing requires CLOUDFLARE_ACCOUNT_ID.",
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("should create a REST context that reports a missing token", async () => {
    vi.spyOn(Config, "aiGateway").mockReturnValue({
      accountId: "test-account",
      name: undefined,
      token: undefined,
      restApiToken: undefined,
      alwaysUse: false,
    });
    context.pathname = "/ai/run";

    await aiGatewayMiddleware(context, next);

    expect(context.aiGateway?.gatewayId).toBe("default");
    expect(context.aiGateway?.restApiToken).toBeUndefined();
  });

  it("should not set AI Gateway if not configured", async () => {
    vi.spyOn(Config, "aiGateway").mockReturnValue({
      accountId: undefined,
      name: undefined,
      token: undefined,
      restApiToken: undefined,
      alwaysUse: false,
    });

    await aiGatewayMiddleware(context, next);

    expect(context.aiGateway).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it.each(["../escape", "%2Fescape", "bad%ZZname"])(
    "rejects an unsafe Gateway path segment: %s",
    async (gatewayName) => {
      vi.spyOn(Config, "aiGateway").mockReturnValue({
        accountId: "test-account",
        name: "default-gateway",
        token: "test-token",
        restApiToken: "rest-token",
        alwaysUse: false,
      });
      context.pathname = `/g/${gatewayName}/v1/models`;

      await expect(aiGatewayMiddleware(context, next)).rejects.toThrow(
        "Invalid AI Gateway name",
      );
      expect(next).not.toHaveBeenCalled();
    },
  );
});
