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
    baseUrl: vi.fn().mockReturnValue("https://api.example.com"),
    endpoint: {
      baseUrl: vi.fn().mockReturnValue("https://api.example.com/test"),
    },
    fetch: vi.fn(),
    getApiKeys: vi.fn().mockReturnValue(["test-key"]),
    getNextApiKeyIndex: vi.fn().mockResolvedValue(0),
    headers: vi.fn().mockResolvedValue({ Authorization: "Bearer test-key" }),
    buildHeadersForPath: vi
      .fn()
      .mockImplementation(async (_pathname, headers) => ({
        ...Object.fromEntries(new Headers(headers).entries()),
        Authorization: "Bearer test-key",
      })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockProviderClass.fetch.mockResolvedValue(new Response());
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
    }) as unknown as (typeof BUILT_IN_PROVIDER_CONSTRUCTORS)[string];

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
        headers: expect.any(Headers),
        signal: mockRequest.signal,
      },
      0,
    );
  });

  it("resolves a named profile for provider pass-through", async () => {
    const request = new Request("https://example.com/ollama:paid/api/show");
    const providers = { get: vi.fn(() => mockProviderClass) };

    await handleProviderProxyRequest(
      { request, providers } as any,
      "ollama:paid",
      "/api/show",
    );

    expect(providers.get).toHaveBeenCalledWith("ollama:paid");
    expect(mockProviderClass.fetch).toHaveBeenCalledWith(
      "/api/show",
      expect.any(Object),
      0,
    );
  });

  it("sends one case-insensitive content-type value upstream", async () => {
    const request = new Request("https://example.com/openai/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-test", messages: [] }),
    });
    const provider = new BUILT_IN_PROVIDER_CONSTRUCTORS.openai();
    const fetchMock = vi.mocked(fetchWithLogging);
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    await provider.fetch(
      "/chat/completions",
      {
        method: request.method,
        body: request.body,
        headers: Object.fromEntries(request.headers.entries()),
      },
      0,
    );

    const init = fetchMock.mock.calls[0][1];
    const headers = new Headers(init?.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(
      [...headers.keys()].filter((key) => key === "content-type"),
    ).toHaveLength(1);
  });

  it("should handle duplicate path segments correctly", async () => {
    const providerName = "testProvider";
    BUILT_IN_PROVIDER_CONSTRUCTORS[providerName] = vi.fn(function () {
      return mockProviderClass;
    }) as unknown as (typeof BUILT_IN_PROVIDER_CONSTRUCTORS)[string];

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
        headers: expect.any(Headers),
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
    }) as unknown as (typeof BUILT_IN_PROVIDER_CONSTRUCTORS)[string];
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
    }) as unknown as (typeof BUILT_IN_PROVIDER_CONSTRUCTORS)[string];
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

  it("uses path-specific Google authentication through AI Gateway", async () => {
    vi.spyOn(CloudflareAIGateway, "isSupportedProvider").mockReturnValue(true);
    const buildProviderEndpointRequest = vi
      .fn()
      .mockReturnValue([
        "https://gateway.example/google-ai-studio/v1beta/openai/chat/completions",
        { method: "POST" },
      ]);
    const request = new Request("https://example.com/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "gemini-test", messages: [] }),
    });

    await handleProviderProxyRequest(
      { request } as any,
      "google-ai-studio",
      "/v1beta/openai/chat/completions",
      { buildProviderEndpointRequest } as any,
    );

    const gatewayHeaders = new Headers(
      buildProviderEndpointRequest.mock.calls[0][0].headers,
    );
    expect(gatewayHeaders.get("Authorization")).toBe("Bearer test-key");
    expect(gatewayHeaders.has("x-goog-api-key")).toBe(false);
  });

  it("routes unsupported providers through a Custom Provider in strict mode", async () => {
    const provider = {
      ...mockProviderClass,
      pathnamePrefix: vi.fn(() => "/v1"),
      requiresCustomAiGatewayProvider: false,
    };
    vi.mocked(CloudflareAIGateway.isSupportedProvider).mockReturnValue(false);
    const buildProviderEndpointRequest = vi
      .fn()
      .mockReturnValue([
        "https://gateway.example/custom-llm-proxy-ollama/v1/models",
        { method: "GET" },
      ]);
    const gateway = {
      alwaysUse: true,
      buildProviderEndpointRequest,
    } as any;
    vi.mocked(fetchWithLogging).mockResolvedValue(new Response("gateway"));
    const request = new Request("https://example.com/ollama/models");

    await handleProviderProxyRequest(
      { request, providers: { get: vi.fn(() => provider) } } as any,
      "ollama",
      "/models",
      gateway,
    );

    expect(buildProviderEndpointRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "custom-llm-proxy-ollama",
        path: "/v1/models",
      }),
    );
    expect(provider.fetch).not.toHaveBeenCalled();
  });

  it("does not forward proxy credentials to a provider", async () => {
    const providerName = "testProvider";
    BUILT_IN_PROVIDER_CONSTRUCTORS[providerName] = vi.fn(function () {
      return mockProviderClass;
    }) as unknown as (typeof BUILT_IN_PROVIDER_CONSTRUCTORS)[string];
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
    expect(new Headers(init.headers)).toEqual(
      new Headers({ "x-client-header": "preserved" }),
    );
    expect(init.signal).toBe(request.signal);
  });

  it("returns an upstream redirect to the caller instead of following it", async () => {
    // Outbound requests use manual redirect handling so credentials are never
    // replayed to the Location host. The 3xx therefore reaches the client
    // unchanged and must not be rewritten or followed by the proxy.
    const providerName = "testProvider";
    BUILT_IN_PROVIDER_CONSTRUCTORS[providerName] = vi.fn(function () {
      return mockProviderClass;
    }) as unknown as (typeof BUILT_IN_PROVIDER_CONSTRUCTORS)[string];
    mockProviderClass.fetch.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: "https://files.example.com/artifact.bin" },
      }),
    );
    const request = new Request("https://example.com/v1/files/artifact");

    const response = await handleProviderProxyRequest(
      { request } as any,
      providerName,
      "/v1/files/artifact",
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "https://files.example.com/artifact.bin",
    );
    expect(mockProviderClass.fetch).toHaveBeenCalledOnce();
  });
});
