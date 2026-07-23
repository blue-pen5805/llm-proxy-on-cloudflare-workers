import { describe, it, expect, vi } from "vitest";
import { CloudflareAIGateway } from "~/src/ai_gateway";
import { handleRouting } from "~/src/middlewares/router";
import { handleAiGatewayRestRequest } from "~/src/requests/ai_gateway_rest";
import { handleCompatibilityRequest } from "~/src/requests/compat";
import { handleMessagesRequest } from "~/src/requests/messages";
import { handleProviderProxyRequest } from "~/src/requests/proxy";
import { handleResponsesRequest } from "~/src/requests/responses";
import { handleVirtualModelsRequest } from "~/src/requests/virtual_models";
import { BadRequestError, NotFoundError } from "~/src/utils/error";

// Mock the request handlers
vi.mock("~/src/requests/chat_completions", () => ({
  handleChatCompletionsRequest: vi.fn(() =>
    Promise.resolve(new Response("chat")),
  ),
}));
vi.mock("~/src/requests/ai_gateway_rest", () => ({
  handleAiGatewayRestRequest: vi.fn(() =>
    Promise.resolve(new Response("rest")),
  ),
}));
vi.mock("~/src/requests/models", () => ({
  handleModelsRequest: vi.fn(() => Promise.resolve(new Response("models"))),
}));
vi.mock("~/src/requests/messages", () => ({
  handleMessagesRequest: vi.fn(() => Promise.resolve(new Response("messages"))),
}));
vi.mock("~/src/requests/responses", () => ({
  handleResponsesRequest: vi.fn(() =>
    Promise.resolve(new Response("responses")),
  ),
}));
vi.mock("~/src/requests/proxy", () => ({
  handleProviderProxyRequest: vi.fn(() =>
    Promise.resolve(new Response("proxy")),
  ),
}));
vi.mock("~/src/requests/status", () => ({
  handleStatusRequest: vi.fn(() => Promise.resolve(new Response("status"))),
}));
vi.mock("~/src/requests/virtual_models", () => ({
  handleVirtualModelsRequest: vi.fn(() => new Response("virtual-models")),
}));
vi.mock("~/src/requests/compat", () => ({
  handleCompatibilityRequest: vi.fn(() =>
    Promise.resolve(new Response("compat")),
  ),
}));
vi.mock("~/src/requests/universal_endpoint", () => ({
  handleUniversalEndpointRequest: vi.fn(() =>
    Promise.resolve(new Response("universal")),
  ),
}));

describe("handleRouting", () => {
  const request = new Request("http://localhost/");

  it("should route to status", async () => {
    const response = await handleRouting({
      request,
      pathname: "/status",
    } as any);
    expect(await response.text()).toBe("status");
  });

  it("should route to ping", async () => {
    const response = await handleRouting({ request, pathname: "/ping" } as any);
    expect(await response.text()).toBe("Pong");
    expect(response.status).toBe(200);
  });

  it("should route to virtual models", async () => {
    const response = await handleRouting({
      request,
      pathname: "/virtual-models",
    } as any);
    expect(await response.text()).toBe("virtual-models");
    expect(handleVirtualModelsRequest).toHaveBeenCalledOnce();
  });

  it("should route to chat completions", async () => {
    const postRequest = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
    });
    const response = await handleRouting({
      request: postRequest,
      pathname: "/v1/chat/completions",
    } as any);
    expect(await response.text()).toBe("chat");
  });

  it("should route to models", async () => {
    const response = await handleRouting({
      request,
      pathname: "/v1/models",
    } as any);
    expect(await response.text()).toBe("models");
  });

  it.each(["/responses", "/v1/responses"])(
    "should route POST %s to Responses",
    async (pathname) => {
      const postRequest = new Request(`http://localhost${pathname}`, {
        method: "POST",
      });
      const response = await handleRouting({
        request: postRequest,
        pathname,
      } as any);

      expect(await response.text()).toBe("responses");
      expect(handleResponsesRequest).toHaveBeenLastCalledWith(
        expect.objectContaining({ request: postRequest }),
        undefined,
      );
    },
  );

  it.each(["/messages", "/v1/messages"])(
    "should route POST %s to Messages",
    async (pathname) => {
      const postRequest = new Request(`http://localhost${pathname}`, {
        method: "POST",
      });
      const response = await handleRouting({
        request: postRequest,
        pathname,
      } as any);

      expect(await response.text()).toBe("messages");
      expect(handleMessagesRequest).toHaveBeenLastCalledWith(
        expect.objectContaining({ request: postRequest }),
        undefined,
      );
    },
  );

  it("should route to proxy for supported providers", async () => {
    const response = await handleRouting({
      request,
      pathname: "/openai/v1/models",
    } as any);
    expect(await response.text()).toBe("proxy");
    expect(handleProviderProxyRequest).toHaveBeenCalledWith(
      expect.anything(),
      "openai",
      "/v1/models",
      undefined,
    );
  });

  it("should route to universal endpoint", async () => {
    const aiGateway = new CloudflareAIGateway("acc", "gate", "key");
    const postRequest = new Request("http://localhost/", { method: "POST" });
    const response = await handleRouting(
      { request: postRequest, pathname: "/" } as any,
      aiGateway,
    );
    expect(await response.text()).toBe("universal");
  });

  it.each([
    ["GET", "/ping", undefined],
    ["GET", "/status", undefined],
    ["GET", "/virtual-models", undefined],
    ["POST", "/compat/chat/completions", "gateway"],
    ["POST", "/ai/run", "gateway"],
    ["POST", "/", "gateway"],
    ["GET", "/unknown", undefined],
  ])(
    "rejects key selection for unsupported route %s %s",
    async (method, pathname, gateway) => {
      const selectedRequest = new Request(`http://localhost${pathname}`, {
        method,
      });
      const aiGateway = gateway
        ? new CloudflareAIGateway("acc", "gate", "key", "rest-key")
        : undefined;

      await expect(
        handleRouting(
          {
            request: selectedRequest,
            pathname,
            apiKeyIndex: 0,
          } as any,
          aiGateway,
        ),
      ).rejects.toThrow(BadRequestError);
    },
  );

  it("should route POST /compat/chat/completions with an AI Gateway", async () => {
    const aiGateway = new CloudflareAIGateway("acc", "gate", "key");
    const postRequest = new Request(
      "http://localhost/compat/chat/completions",
      { method: "POST" },
    );
    const response = await handleRouting(
      {
        request: postRequest,
        pathname: "/compat/chat/completions",
      } as any,
      aiGateway,
    );

    expect(await response.text()).toBe("compat");
    expect(handleCompatibilityRequest).toHaveBeenCalledWith(
      postRequest,
      aiGateway,
    );
  });

  it.each([
    ["GET", "/compat/chat/completions"],
    ["POST", "/compat/models"],
    ["POST", "/compat/chat/completions/extra"],
  ])(
    "should reject unsupported compat route %s %s",
    async (method, pathname) => {
      const aiGateway = new CloudflareAIGateway("acc", "gate", "key");
      const compatRequest = new Request(`http://localhost${pathname}`, {
        method,
      });

      await expect(
        handleRouting({ request: compatRequest, pathname } as any, aiGateway),
      ).rejects.toThrow(NotFoundError);
    },
  );

  it("should not fall through unsupported compat paths to provider routing", async () => {
    const aiGateway = new CloudflareAIGateway("acc", "gate", "key");
    const providers = {
      match: vi.fn(() => ({
        providerName: "compat",
        pathname: "/models",
      })),
    };
    const postRequest = new Request("http://localhost/compat/models", {
      method: "POST",
    });

    await expect(
      handleRouting(
        {
          request: postRequest,
          pathname: "/compat/models",
          providers,
        } as any,
        aiGateway,
      ),
    ).rejects.toThrow(NotFoundError);
    expect(providers.match).not.toHaveBeenCalled();
  });

  it.each([
    "/ai/run",
    "/ai/v1/chat/completions",
    "/ai/v1/responses",
    "/ai/v1/messages",
  ] as const)(
    "should route POST %s to the AI Gateway REST API",
    async (path) => {
      const aiGateway = new CloudflareAIGateway(
        "acc",
        "gate",
        undefined,
        "rest-token",
      );
      const postRequest = new Request(`http://localhost${path}`, {
        method: "POST",
      });

      const response = await handleRouting(
        { request: postRequest, pathname: path } as any,
        aiGateway,
      );

      expect(await response.text()).toBe("rest");
      expect(handleAiGatewayRestRequest).toHaveBeenLastCalledWith(
        postRequest,
        path,
        aiGateway,
      );
    },
  );

  it("should require an account configuration for REST API routes", async () => {
    const postRequest = new Request("http://localhost/ai/run", {
      method: "POST",
    });

    await expect(
      handleRouting({ request: postRequest, pathname: "/ai/run" } as any),
    ).rejects.toThrow("AI Gateway REST API requires CLOUDFLARE_ACCOUNT_ID.");
  });

  it.each([
    ["GET", "/ai/run"],
    ["POST", "/ai/v1/models"],
    ["POST", "/ai/v1/responses/extra"],
  ])("should reject unsupported REST API route %s %s", async (method, path) => {
    const aiGateway = new CloudflareAIGateway(
      "acc",
      "gate",
      undefined,
      "rest-token",
    );
    const request = new Request(`http://localhost${path}`, { method });

    await expect(
      handleRouting({ request, pathname: path } as any, aiGateway),
    ).rejects.toThrow(NotFoundError);
  });

  it("should throw NotFoundError for unknown routes", async () => {
    await expect(
      handleRouting({ request, pathname: "/unknown" } as any),
    ).rejects.toThrow(NotFoundError);
  });
});
