import { describe, it, expect, vi, beforeEach } from "vitest";
import { CloudflareAIGateway } from "~/src/ai_gateway";
import { BUILT_IN_PROVIDER_CONSTRUCTORS } from "~/src/providers";
import { getProviderByName } from "~/src/providers";
import { handleProviderProxyRequest } from "~/src/requests/proxy";
import { Environments } from "~/src/utils/environments";
import { NotFoundError } from "~/src/utils/error";
import { fetchWithLogging } from "~/src/utils/helpers";
import { Secrets } from "~/src/utils/secrets";

vi.mock("~/src/providers", async () => {
  const actual =
    await vi.importActual<typeof import("~/src/providers")>("~/src/providers");
  return {
    ...actual,
    getProviderByName: vi.fn(),
  };
});
vi.mock("~/src/providers/ai_gateway");
vi.mock("~/src/utils/helpers");
vi.mock("~/src/utils/environments");
vi.mock("~/src/utils/secrets");

describe("proxy", () => {
  const mockProviderClass = {
    endpoint: {
      baseUrl: vi.fn().mockReturnValue("https://api.example.com/test"),
    },
    fetch: vi.fn(),
    getApiKeys: vi.fn().mockReturnValue(["test-key"]),
    getNextApiKeyIndex: vi.fn().mockResolvedValue(0),
    headers: vi.fn().mockResolvedValue({ Authorization: "Bearer test-key" }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Secrets.getAll).mockReturnValue(["test-key"]);
    vi.mocked(Secrets.getNext).mockResolvedValue(0);
    vi.mocked(Environments.all).mockReturnValue({} as any);

    vi.mocked(getProviderByName).mockImplementation((name) => {
      const ProviderClass = BUILT_IN_PROVIDER_CONSTRUCTORS[name];
      return ProviderClass ? new (ProviderClass as any)() : undefined;
    });
  });

  it("should call providerClass.fetch with correct arguments", async () => {
    const providerName = "testProvider";
    BUILT_IN_PROVIDER_CONSTRUCTORS[providerName] = vi.fn(function () {
      return mockProviderClass;
    });

    const mockRequest = new Request("https://example.com/test/path", {
      method: "GET",
      body: null,
      headers: new Headers(),
    });

    const providers = { get: vi.fn(() => mockProviderClass) };
    await handleProviderProxyRequest(
      { request: mockRequest, providers } as any,
      providerName,
      "/test/path",
    );

    expect(providers.get).toHaveBeenCalledWith(providerName);
    expect(mockProviderClass.fetch).toHaveBeenCalledWith(
      "/test/path",
      {
        method: mockRequest.method,
        body: mockRequest.body,
        headers: {},
        signal: mockRequest.signal,
      },
      0,
    );
  });

  it("should handle duplicate path segments correctly", async () => {
    const providerName = "testProvider";
    BUILT_IN_PROVIDER_CONSTRUCTORS[providerName] = vi.fn(function () {
      return mockProviderClass;
    });

    const mockRequest = new Request("https://example.com/test/test/path", {
      method: "GET",
      body: null,
      headers: new Headers(),
    });

    await handleProviderProxyRequest(
      { request: mockRequest } as any,
      providerName,
      "/test/path",
    );

    expect(mockProviderClass.fetch).toHaveBeenCalledWith(
      "/test/path",
      {
        method: mockRequest.method,
        body: mockRequest.body,
        headers: {},
        signal: mockRequest.signal,
      },
      0,
    );
  });

  it("throws NotFoundError for an unknown provider", async () => {
    vi.mocked(getProviderByName).mockReturnValue(undefined);
    const request = new Request("https://example.com/missing");

    await expect(
      handleProviderProxyRequest({ request } as any, "missing", "/missing"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects direct pass-through for a Gateway-only provider", async () => {
    const gatewayOnlyProvider = {
      ...mockProviderClass,
      requiresAiGateway: true,
      requiresAuthenticatedAiGateway: true,
    };
    const response = await handleProviderProxyRequest(
      {
        request: new Request("https://example.com/google-vertex-ai/path"),
        providers: { get: vi.fn(() => gatewayOnlyProvider) },
      } as any,
      "google-vertex-ai",
      "/path",
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "google-vertex-ai requires Cloudflare AI Gateway.",
    });
    expect(gatewayOnlyProvider.fetch).not.toHaveBeenCalled();
  });

  it("resolves an explicit key selection from middleware context", async () => {
    const providerName = "selectedProvider";
    BUILT_IN_PROVIDER_CONSTRUCTORS[providerName] = vi.fn(function () {
      return mockProviderClass;
    });
    vi.mocked(Secrets.resolveApiKeyIndex).mockReturnValue(2);
    const request = new Request("https://example.com/models");

    await handleProviderProxyRequest(
      { request, apiKeyIndex: { start: 1, end: 2 } } as any,
      providerName,
      "/models",
    );

    expect(Secrets.resolveApiKeyIndex).toHaveBeenCalledWith(
      { start: 1, end: 2 },
      1,
    );
    expect(mockProviderClass.getNextApiKeyIndex).not.toHaveBeenCalled();
    expect(mockProviderClass.fetch).toHaveBeenCalledWith(
      "/models",
      expect.any(Object),
      2,
    );
  });

  it("routes supported providers through AI Gateway", async () => {
    const providerName = "openai";
    BUILT_IN_PROVIDER_CONSTRUCTORS[providerName] = vi.fn(function () {
      return mockProviderClass;
    });
    vi.spyOn(CloudflareAIGateway, "isSupportedProvider").mockReturnValue(true);
    const buildProviderEndpointRequest = vi
      .fn()
      .mockReturnValue([
        "https://gateway.example/openai/models",
        { method: "GET" },
      ]);
    const gateway = { buildProviderEndpointRequest } as any;
    vi.mocked(fetchWithLogging).mockResolvedValue(new Response("gateway"));
    const request = new Request("https://example.com/models", {
      headers: {
        "X-Request": "value",
        "cf-aig-max-attempts": "3",
      },
    });

    const response = await handleProviderProxyRequest(
      { request } as any,
      providerName,
      "/models",
      gateway,
    );

    expect(buildProviderEndpointRequest).toHaveBeenCalledWith({
      provider: "openai",
      method: "GET",
      path: "/models",
      body: request.body,
      headers: expect.any(Object),
    });
    const gatewayHeaders = new Headers(
      buildProviderEndpointRequest.mock.calls[0][0].headers,
    );
    expect(gatewayHeaders.get("Authorization")).toBe("Bearer test-key");
    expect(gatewayHeaders.get("X-Request")).toBe("value");
    expect(gatewayHeaders.get("cf-aig-max-attempts")).toBe("3");
    expect(fetchWithLogging).toHaveBeenCalledWith(
      "https://gateway.example/openai/models",
      { method: "GET", signal: request.signal },
    );
    expect(await response.text()).toBe("gateway");
  });

  it("does not forward proxy credentials to a provider", async () => {
    const providerName = "testProvider";
    BUILT_IN_PROVIDER_CONSTRUCTORS[providerName] = vi.fn(function () {
      return mockProviderClass;
    });
    const request = new Request("https://example.com/test", {
      headers: {
        Authorization: "Bearer proxy-secret",
        "x-api-key": "proxy-secret",
        "x-goog-api-key": "proxy-secret",
        "cf-aig-metadata": '{"tenant":"must-not-leak"}',
        "x-client-header": "preserved",
      },
    });

    await handleProviderProxyRequest({ request } as any, providerName, "/test");

    const init = mockProviderClass.fetch.mock.calls[0][1];
    expect(init.headers).toEqual({ "x-client-header": "preserved" });
    expect(init.signal).toBe(request.signal);
  });
});
