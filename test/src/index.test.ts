import { SELF } from "cloudflare:test";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  BUILT_IN_PROVIDER_CONSTRUCTORS,
  createProviderRegistry,
  getAllProviderInstances,
  getProviderByName,
} from "~/src/providers";
import { handleAiGatewayRestRequest } from "~/src/requests/ai_gateway_rest";
import { handleChatCompletionsRequest } from "~/src/requests/chat_completions";
import { handleCompatibilityRequest } from "~/src/requests/compat";
import { handleModelsRequest } from "~/src/requests/models";
import { handleOptions } from "~/src/requests/options";
import { handleProviderProxyRequest } from "~/src/requests/proxy";
import { handleUniversalEndpointRequest } from "~/src/requests/universal_endpoint";
import { isRequestAuthorized } from "~/src/utils/authorization";
import { Config } from "~/src/utils/config";
import { Environments } from "~/src/utils/environments";
import { ConfigurationError } from "~/src/utils/error";

vi.mock("~/src/ai_gateway", () => {
  const MockCloudflareAIGateway = vi.fn(function () {
    return {
      baseUrl: vi.fn(() => "https://gateway.ai.cloudflare.com"),
      buildHeaders: vi.fn(() => ({})),
      buildUniversalEndpointRequest: vi.fn(() => ["", {}]),
      buildCompatibilityEndpointRequest: vi.fn(() => ["", {}]),
      buildProviderEndpointRequest: vi.fn(() => ["", {}]),
      buildChatCompletionsRequests: vi.fn(() => [["", {}]]),
      buildRestApiRequest: vi.fn(() => ["", {}]),
    };
  });

  // Add static methods as properties
  (MockCloudflareAIGateway as any).isSupportedProvider = vi.fn(() => true);

  return {
    CloudflareAIGateway: MockCloudflareAIGateway,
  };
});
vi.mock("~/src/providers", () => {
  const BUILT_IN_PROVIDER_CONSTRUCTORS = {
    openai: vi.fn(function () {
      return {
        name: "openai",
        baseUrl: "https://api.openai.com",
        headers: vi.fn().mockResolvedValue({}),
      };
    }),
  };
  const getAllProviderInstances = vi.fn();
  const getProviderByName = vi.fn();

  return {
    BUILT_IN_PROVIDER_CONSTRUCTORS,
    getAllProviderInstances,
    getProviderByName,
    createProviderRegistry: vi.fn(() => ({
      all: () => getAllProviderInstances(),
      get: (name: string) => getProviderByName(name),
      match: (pathname: string) => {
        const providerName = Object.keys(getAllProviderInstances()).find(
          (name) => pathname.startsWith(`/${name}/`),
        );
        return providerName
          ? {
              providerName,
              pathname: pathname.slice(providerName.length + 1),
            }
          : undefined;
      },
    })),
  };
});
vi.mock("~/src/utils/environments", () => ({
  Environments: {
    all: vi.fn(() => ({})),
    get: vi.fn(),
    setEnv: vi.fn(),
    run: vi.fn((_env, callback) => callback()),
  },
}));
vi.mock("~/src/requests/options", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/src/requests/options")>()),
  handleOptions: vi.fn(async () => new Response()),
}));
vi.mock("~/src/requests/proxy", () => ({
  handleProviderProxyRequest: vi.fn(async () => new Response()),
}));
vi.mock("~/src/requests/chat_completions", () => ({
  handleChatCompletionsRequest: vi.fn(async () => new Response()),
}));
vi.mock("~/src/requests/ai_gateway_rest", () => ({
  handleAiGatewayRestRequest: vi.fn(async () => new Response()),
}));
vi.mock("~/src/requests/models", () => ({
  handleModelsRequest: vi.fn(async () => new Response()),
}));
vi.mock("~/src/requests/universal_endpoint", () => ({
  handleUniversalEndpointRequest: vi.fn(async () => new Response()),
}));
vi.mock("~/src/requests/compat", () => ({
  handleCompatibilityRequest: vi.fn(async () => new Response()),
}));
vi.mock("~/src/utils/authorization", () => ({
  isRequestAuthorized: vi.fn(),
  AUTHORIZATION_QUERY_PARAMETERS: ["key"],
}));
vi.mock("~/src/utils/config", () => ({
  Config: { isDevelopment: vi.fn(), apiKeys: vi.fn(), aiGateway: vi.fn() },
}));

describe("fetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(isRequestAuthorized).mockReturnValue(true);
    vi.mocked(Config.isDevelopment).mockReturnValue(false);
    vi.mocked(Config.apiKeys).mockReturnValue(["test-key"]);
    vi.mocked(Config.aiGateway).mockReturnValue({
      accountId: "test-account-id",
      name: "test-gateway",
      token: "test-token",
      restApiToken: "rest-token",
    });
    vi.mocked(getAllProviderInstances).mockImplementation(() => ({
      openai: new (BUILT_IN_PROVIDER_CONSTRUCTORS.openai as any)(),
    }));

    vi.mocked(getProviderByName).mockImplementation((name) => {
      if (name === "openai")
        return new (BUILT_IN_PROVIDER_CONSTRUCTORS.openai as any)();
      return undefined;
    });

    vi.mocked(Environments.all).mockReturnValue({} as any);

    // Ensure the built-in OpenAI constructor is available for routing.
    BUILT_IN_PROVIDER_CONSTRUCTORS.openai = vi.fn(function () {
      return {
        name: "openai",
        baseUrl: "https://api.openai.com",
        headers: vi.fn().mockResolvedValue({}),
      };
    });
  });

  it("should handle OPTIONS request", async () => {
    const response = await SELF.fetch("https://example.com", {
      method: "OPTIONS",
    });

    expect(handleOptions).toHaveBeenCalledOnce();
    expect(isRequestAuthorized).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it("should succeed with authentication", async () => {
    const response = await SELF.fetch("https://example.com/ping");

    expect(isRequestAuthorized).toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it("should fail with invalid authentication", async () => {
    vi.mocked(isRequestAuthorized).mockReturnValue(false);

    const response = await SELF.fetch("https://example.com/ping");

    expect(isRequestAuthorized).toHaveBeenCalled();
    expect(response.status).toBe(401);
  });

  it("should add CORS headers to authentication errors", async () => {
    vi.mocked(isRequestAuthorized).mockReturnValue(false);

    const response = await SELF.fetch("https://example.com/ping", {
      headers: { Origin: "https://client.example" },
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("returns a safe configuration error for an invalid provider registry", async () => {
    vi.mocked(createProviderRegistry).mockImplementationOnce(() => {
      throw new ConfigurationError("CUSTOM_OPENAI_ENDPOINTS");
    });

    const response = await SELF.fetch("https://example.com/ping", {
      headers: { Origin: "https://client.example" },
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        message: "Invalid configuration for CUSTOM_OPENAI_ENDPOINTS.",
        status: 503,
      },
    });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("should skip authentication in development mode", async () => {
    vi.mocked(Config.isDevelopment).mockReturnValue(true);

    const response = await SELF.fetch("https://example.com/ping");

    expect(isRequestAuthorized).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it("should handle chat completions request", async () => {
    const request = new Request("https://example.com/chat/completions", {
      method: "POST",
    });

    await SELF.fetch(request);

    expect(handleChatCompletionsRequest).toHaveBeenCalledOnce();
  });

  it("should handle v1 chat completions request", async () => {
    const request = new Request("https://example.com/v1/chat/completions", {
      method: "POST",
    });

    await SELF.fetch(request);

    expect(handleChatCompletionsRequest).toHaveBeenCalledOnce();
  });

  it("should handle models request", async () => {
    const request = new Request("https://example.com/models", {
      method: "GET",
    });

    await SELF.fetch(request);

    expect(handleModelsRequest).toHaveBeenCalledOnce();
  });

  it("should handle v1 models request", async () => {
    const request = new Request("https://example.com/v1/models", {
      method: "GET",
    });

    await SELF.fetch(request);

    expect(handleModelsRequest).toHaveBeenCalledOnce();
  });

  it("should handle AI Gateway chat completions request", async () => {
    const request = new Request(
      "https://example.com/g/test-gateway/chat/completions",
      {
        method: "POST",
      },
    );

    await SELF.fetch(request);

    expect(handleChatCompletionsRequest).toHaveBeenCalledOnce();
  });

  it("should handle AI Gateway models request", async () => {
    const request = new Request("https://example.com/g/test-gateway/models", {
      method: "GET",
    });

    await SELF.fetch(request);

    expect(handleModelsRequest).toHaveBeenCalledOnce();
  });

  it("should handle AI Gateway universal endpoint request", async () => {
    const request = new Request("https://example.com/g/test-gateway/", {
      method: "POST",
    });

    await SELF.fetch(request);

    expect(handleUniversalEndpointRequest).toHaveBeenCalledOnce();
  });

  it("should handle AI Gateway compat request", async () => {
    const request = new Request(
      "https://example.com/g/test-gateway/compat/chat/completions",
      {
        method: "POST",
      },
    );

    await SELF.fetch(request);

    expect(handleCompatibilityRequest).toHaveBeenCalledOnce();
  });

  it.each([
    ["GET", "/g/test-gateway/compat/chat/completions"],
    ["POST", "/g/test-gateway/compat/models"],
    ["POST", "/g/test-gateway/compat/chat/completions/extra"],
  ])(
    "should reject unsupported AI Gateway compat route %s %s",
    async (method, path) => {
      const response = await SELF.fetch(`https://example.com${path}`, {
        method,
      });

      expect(response.status).toBe(404);
      expect(handleCompatibilityRequest).not.toHaveBeenCalled();
    },
  );

  it.each([
    "/ai/run",
    "/ai/v1/chat/completions",
    "/ai/v1/responses",
    "/ai/v1/messages",
  ] as const)("should handle AI Gateway REST route %s", async (path) => {
    const request = new Request(`https://example.com/g/team-gateway${path}`, {
      method: "POST",
    });

    await SELF.fetch(request);

    expect(handleAiGatewayRestRequest).toHaveBeenLastCalledWith(
      request,
      path,
      expect.anything(),
    );
  });

  it.each([
    ["GET", "/g/team-gateway/ai/run"],
    ["POST", "/g/team-gateway/ai/v1/models"],
  ])(
    "should reject unsupported AI Gateway REST route %s %s",
    async (method, path) => {
      const response = await SELF.fetch(`https://example.com${path}`, {
        method,
      });

      expect(response.status).toBe(404);
      expect(handleAiGatewayRestRequest).not.toHaveBeenCalled();
    },
  );

  it("should handle requests starting with {PROVIDER_NAME}", async () => {
    await SELF.fetch("https://example.com/openai/notfound");

    expect(handleProviderProxyRequest).toHaveBeenCalledOnce();
  });

  it("should handle universal endpoint request", async () => {
    const request = new Request("https://example.com", {
      method: "POST",
    });

    await SELF.fetch(request);

    expect(handleUniversalEndpointRequest).toHaveBeenCalledOnce();
  });

  it("should return 404 for unknown routes", async () => {
    const response = await SELF.fetch("https://example.com/unknown-route");

    expect(response.status).toBe(404);
  });

  it("returns 400 when key selection prefixes an unsupported route", async () => {
    const response = await SELF.fetch("https://example.com/key/0/ping");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        message: "API key selection is not supported for this route.",
        status: 400,
      },
    });
  });

  it("should remove authorization query parameters from pathname", async () => {
    // Mock the proxy function to capture the arguments
    const mockProxy = vi.mocked(handleProviderProxyRequest);

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
