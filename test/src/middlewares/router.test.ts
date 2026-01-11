import { describe, it, expect, vi } from "vitest";
import { CloudflareAIGateway } from "~/src/ai_gateway";
import { handleRouting } from "~/src/middlewares/router";
import { NotFoundError } from "~/src/utils/error";

// Mock the request handlers
vi.mock("~/src/requests/chat_completions", () => ({
  chatCompletions: vi.fn(() => Promise.resolve(new Response("chat"))),
}));
vi.mock("~/src/requests/models", () => ({
  models: vi.fn(() => Promise.resolve(new Response("models"))),
}));
vi.mock("~/src/requests/proxy", () => ({
  proxy: vi.fn(() => Promise.resolve(new Response("proxy"))),
}));
vi.mock("~/src/requests/status", () => ({
  status: vi.fn(() => Promise.resolve(new Response("status"))),
}));
vi.mock("~/src/requests/compat", () => ({
  compat: vi.fn(() => Promise.resolve(new Response("compat"))),
}));
vi.mock("~/src/requests/universal_endpoint", () => ({
  universalEndpoint: vi.fn(() => Promise.resolve(new Response("universal"))),
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

  it("should route to proxy for supported providers", async () => {
    const response = await handleRouting({
      request,
      pathname: "/openai/v1/models",
    } as any);
    expect(await response.text()).toBe("proxy");
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

  it("should throw NotFoundError for unknown routes", async () => {
    await expect(
      handleRouting({ request, pathname: "/unknown" } as any),
    ).rejects.toThrow(NotFoundError);
  });
});
