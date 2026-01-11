import { SELF } from "cloudflare:test";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Providers, getAllProviders, getProvider } from "~/src/providers";
import { chatCompletions } from "~/src/requests/chat_completions";
import { compat } from "~/src/requests/compat";
import { models } from "~/src/requests/models";
import { handleOptions } from "~/src/requests/options";
import { proxy } from "~/src/requests/proxy";
import { universalEndpoint } from "~/src/requests/universal_endpoint";
import { authenticate } from "~/src/utils/authorization";
import { Config } from "~/src/utils/config";
import { Environments } from "~/src/utils/environments";

vi.mock("~/src/ai_gateway", () => {
  const MockCloudflareAIGateway = vi.fn().mockImplementation(() => ({
    baseUrl: vi.fn(() => "https://gateway.ai.cloudflare.com"),
    buildHeaders: vi.fn(() => ({})),
    buildUniversalEndpointRequest: vi.fn(() => ["", {}]),
    buildProviderEndpointRequest: vi.fn(() => ["", {}]),
    buildChatCompletionsRequest: vi.fn(() => ["", {}]),
    buildCompatRequest: vi.fn(() => ["", {}]),
  }));

  // Add static methods as properties
  (MockCloudflareAIGateway as any).isSupportedProvider = vi.fn(() => true);

  return {
    CloudflareAIGateway: MockCloudflareAIGateway,
  };
});
vi.mock("~/src/providers", () => ({
  Providers: {
    openai: vi.fn().mockImplementation(() => ({
      name: "openai",
      baseUrl: "https://api.openai.com",
      headers: vi.fn().mockResolvedValue({}),
    })),
  },
  getAllProviders: vi.fn(),
  getProvider: vi.fn(),
}));
vi.mock("~/src/utils/environments", () => ({
  Environments: {
    all: vi.fn(() => ({})),
    get: vi.fn(),
    setEnv: vi.fn(),
  },
}));
vi.mock("~/src/requests/options", () => ({
  handleOptions: vi.fn(async () => new Response()),
}));
vi.mock("~/src/requests/proxy", () => ({
  proxy: vi.fn(async () => new Response()),
}));
vi.mock("~/src/requests/chat_completions", () => ({
  chatCompletions: vi.fn(async () => new Response()),
}));
vi.mock("~/src/requests/models", () => ({
  models: vi.fn(async () => new Response()),
}));
vi.mock("~/src/requests/universal_endpoint", () => ({
  universalEndpoint: vi.fn(async () => new Response()),
}));
vi.mock("~/src/requests/compat", () => ({
  compat: vi.fn(async () => new Response()),
}));
vi.mock("~/src/utils/authorization", () => ({
  authenticate: vi.fn(),
  AUTHORIZATION_QUERY_PARAMETERS: ["key"],
}));
vi.mock("~/src/utils/config", () => ({
  Config: { isDevelopment: vi.fn(), aiGateway: vi.fn() },
}));

describe("fetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(authenticate).mockReturnValue(true);
    vi.mocked(Config.isDevelopment).mockReturnValue(false);
    vi.mocked(Config.aiGateway).mockReturnValue({
      accountId: "test-account-id",
      name: "test-gateway",
      token: "test-token",
    });
    vi.mocked(getAllProviders).mockImplementation(() => ({
      openai: new (Providers.openai as any)(),
    }));

    vi.mocked(getProvider).mockImplementation((name) => {
      if (name === "openai") return new (Providers.openai as any)();
      return undefined;
    });

    vi.mocked(Environments.all).mockReturnValue({} as any);

    // Ensure Providers.openai is set up correctly for routing
    Providers.openai = vi.fn().mockImplementation(() => ({
      name: "openai",
      baseUrl: "https://api.openai.com",
      headers: vi.fn().mockResolvedValue({}),
    }));
  });

  it("should handle OPTIONS request", async () => {
    const response = await SELF.fetch("https://example.com", {
      method: "OPTIONS",
    });

    expect(handleOptions).toHaveBeenCalledOnce();
    expect(authenticate).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it("should succeed with authentication", async () => {
    const response = await SELF.fetch("https://example.com/ping");

    expect(authenticate).toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it("should fail with invalid authentication", async () => {
    vi.mocked(authenticate).mockReturnValue(false);

    const response = await SELF.fetch("https://example.com/ping");

    expect(authenticate).toHaveBeenCalled();
    expect(response.status).toBe(401);
  });

  it("should skip authentication in development mode", async () => {
    vi.mocked(Config.isDevelopment).mockReturnValue(true);

    const response = await SELF.fetch("https://example.com/ping");

    expect(authenticate).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it("should handle chat completions request", async () => {
    const request = new Request("https://example.com/chat/completions", {
      method: "POST",
    });

    await SELF.fetch(request);

    expect(chatCompletions).toHaveBeenCalledOnce();
  });

  it("should handle v1 chat completions request", async () => {
    const request = new Request("https://example.com/v1/chat/completions", {
      method: "POST",
    });

    await SELF.fetch(request);

    expect(chatCompletions).toHaveBeenCalledOnce();
  });

  it("should handle models request", async () => {
    const request = new Request("https://example.com/models", {
      method: "GET",
    });

    await SELF.fetch(request);

    expect(models).toHaveBeenCalledOnce();
  });

  it("should handle v1 models request", async () => {
    const request = new Request("https://example.com/v1/models", {
      method: "GET",
    });

    await SELF.fetch(request);

    expect(models).toHaveBeenCalledOnce();
  });

  it("should handle AI Gateway chat completions request", async () => {
    const request = new Request(
      "https://example.com/g/test-gateway/chat/completions",
      {
        method: "POST",
      },
    );

    await SELF.fetch(request);

    expect(chatCompletions).toHaveBeenCalledOnce();
  });

  it("should handle AI Gateway models request", async () => {
    const request = new Request("https://example.com/g/test-gateway/models", {
      method: "GET",
    });

    await SELF.fetch(request);

    expect(models).toHaveBeenCalledOnce();
  });

  it("should handle AI Gateway universal endpoint request", async () => {
    const request = new Request("https://example.com/g/test-gateway/", {
      method: "POST",
    });

    await SELF.fetch(request);

    expect(universalEndpoint).toHaveBeenCalledOnce();
  });

  it("should handle AI Gateway compat request", async () => {
    const request = new Request(
      "https://example.com/g/test-gateway/compat/chat/completions",
      {
        method: "POST",
      },
    );

    await SELF.fetch(request);

    expect(compat).toHaveBeenCalledOnce();
  });

  it("should handle requests starting with {PROVIDER_NAME}", async () => {
    await SELF.fetch("https://example.com/openai/notfound");

    expect(proxy).toHaveBeenCalledOnce();
  });

  it("should handle universal endpoint request", async () => {
    const request = new Request("https://example.com", {
      method: "POST",
    });

    await SELF.fetch(request);

    expect(universalEndpoint).toHaveBeenCalledOnce();
  });

  it("should return 404 for unknown routes", async () => {
    const response = await SELF.fetch("https://example.com/unknown-route");

    expect(response.status).toBe(404);
  });

  it("should remove authorization query parameters from pathname", async () => {
    // Mock the proxy function to capture the arguments
    const mockProxy = vi.mocked(proxy);

    // Request with key parameter
    await SELF.fetch(
      "https://example.com/openai/v1/chat/completions?key=test-key&other=value",
    );

    // Check that proxy was called with the pathname without the key parameter
    expect(mockProxy).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.any(Request),
      }),
      "openai",
      "/v1/chat/completions?other=value",
      expect.anything(),
    );
  });
});
