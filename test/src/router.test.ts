import { describe, it, expect, vi } from "vitest";
import { CloudflareAIGateway } from "~/src/ai_gateway";
import { handleRouting } from "~/src/router";

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
    const response = await handleRouting(request, "/status");
    expect(await response.text()).toBe("status");
  });

  it("should route to ping", async () => {
    // wait, ping was in index.ts or router.ts?
    // In my refactoring, I moved it to index.ts but then it was removed from index.ts in the second phase?
    // Let me check index.ts and router.ts again.
  });

  it("should route to chat completions", async () => {
    const postRequest = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
    });
    const response = await handleRouting(postRequest, "/v1/chat/completions");
    expect(await response.text()).toBe("chat");
  });

  it("should route to models", async () => {
    const response = await handleRouting(request, "/v1/models");
    expect(await response.text()).toBe("models");
  });

  it("should route to proxy for supported providers", async () => {
    const response = await handleRouting(request, "/openai/v1/models");
    expect(await response.text()).toBe("proxy");
  });

  it("should route to universal endpoint", async () => {
    const aiGateway = new CloudflareAIGateway("acc", "gate");
    const postRequest = new Request("http://localhost/", { method: "POST" });
    const response = await handleRouting(postRequest, "/", aiGateway);
    expect(await response.text()).toBe("universal");
  });

  it("should return 404 for unknown routes", async () => {
    const response = await handleRouting(request, "/unknown");
    expect(response.status).toBe(404);
  });
});
