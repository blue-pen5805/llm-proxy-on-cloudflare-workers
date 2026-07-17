import { describe, it, expect, vi, beforeEach } from "vitest";
import { CloudflareAIGateway } from "~/src/ai_gateway";
import { BUILT_IN_PROVIDER_CONSTRUCTORS } from "~/src/providers";
import { getProviderByName } from "~/src/providers";
import { handleChatCompletionsRequest } from "~/src/requests/chat_completions";
import { Config } from "~/src/utils/config";
import * as helpers from "~/src/utils/helpers";
import { Secrets } from "~/src/utils/secrets";

vi.mock("~/src/ai_gateway");
vi.mock("~/src/providers", async () => {
  const actual =
    await vi.importActual<typeof import("~/src/providers")>("~/src/providers");
  return {
    ...actual,
    getProviderByName: vi.fn(),
  };
});
vi.mock("~/src/utils/config");
vi.mock("~/src/utils/helpers");
vi.mock("~/src/utils/secrets");

describe("handleChatCompletionsRequest", () => {
  const mockProviderClass = {
    buildChatCompletionsRequest: vi.fn(),
    filterSupportedChatParameters: vi.fn(
      (data: Record<string, unknown>) => data,
    ),
    fetch: vi.fn(),
    apiKeyName: "OPENAI_API_KEY",
    getApiKeys: vi.fn().mockReturnValue(["test-key"]),
    getNextApiKeyIndex: vi.fn().mockResolvedValue(0),
  };

  const mockAIGateway = {
    buildChatCompletionsRequests: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(helpers.parseJsonOrReturnText).mockImplementation((str) => {
      try {
        return JSON.parse(str);
      } catch {
        return str;
      }
    });
    vi.mocked(helpers.readRequestText).mockImplementation((request) =>
      request.text(),
    );
    vi.mocked(helpers.fetchWithLogging).mockResolvedValue(new Response());
    vi.mocked(CloudflareAIGateway.isSupportedProvider).mockReturnValue(true);
    BUILT_IN_PROVIDER_CONSTRUCTORS.openai = vi.fn(function () {
      return mockProviderClass;
    });
    vi.mocked(Config.defaultModel).mockReturnValue("openai/gpt-4");
    vi.mocked(Secrets.getAll).mockReturnValue(["test-key"]);
    vi.mocked(Secrets.getNext).mockResolvedValue(0);

    vi.mocked(getProviderByName).mockImplementation((name) => {
      const ProviderClass = BUILT_IN_PROVIDER_CONSTRUCTORS[name];
      return ProviderClass ? new (ProviderClass as any)() : undefined;
    });
  });

  it("should handle valid chat completions request", async () => {
    const requestBody = {
      model: "openai/gpt-4",
      messages: [{ role: "user", content: "Hello" }],
    };

    const request = new Request("https://example.com/chat/completions", {
      method: "POST",
      body: JSON.stringify(requestBody),
      headers: {
        "Content-Type": "application/json",
        "cf-aig-skip-cache": "true",
      },
    });

    mockProviderClass.buildChatCompletionsRequest.mockReturnValue([
      "/chat/completions",
      {
        method: "POST",
        body: JSON.stringify({ ...requestBody, model: "gpt-4" }),
      },
    ]);
    mockProviderClass.fetch.mockResolvedValue(new Response());

    const providers = { get: vi.fn(() => mockProviderClass) };
    await handleChatCompletionsRequest({ request, providers } as any);

    expect(providers.get).toHaveBeenCalledWith("openai");
    expect(mockProviderClass.buildChatCompletionsRequest).toHaveBeenCalledWith({
      body: "",
      preparedData: { ...requestBody, model: "gpt-4" },
      headers: expect.any(Headers),
      apiKeyIndex: 0,
    });
    expect(
      mockProviderClass.buildChatCompletionsRequest.mock.calls[0][0].headers.has(
        "cf-aig-skip-cache",
      ),
    ).toBe(false);
    expect(mockProviderClass.fetch).toHaveBeenCalled();
  });

  it("uses an explicit middleware key selection", async () => {
    const requestBody = {
      model: "openai/gpt-4",
      messages: [],
    };
    const request = new Request("https://example.com/chat/completions", {
      method: "POST",
      body: JSON.stringify(requestBody),
    });
    vi.mocked(Secrets.resolveApiKeyIndex).mockReturnValue(2);
    mockProviderClass.buildChatCompletionsRequest.mockReturnValue([
      "/chat/completions",
      { method: "POST", body: JSON.stringify(requestBody) },
    ]);
    mockProviderClass.fetch.mockResolvedValue(new Response());

    await handleChatCompletionsRequest({
      request,
      apiKeyIndex: { start: 1, end: 2 },
    } as any);

    expect(Secrets.resolveApiKeyIndex).toHaveBeenCalledWith(
      { start: 1, end: 2 },
      1,
    );
    expect(mockProviderClass.getNextApiKeyIndex).not.toHaveBeenCalled();
    expect(mockProviderClass.buildChatCompletionsRequest).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyIndex: 2 }),
    );
    expect(mockProviderClass.fetch).toHaveBeenCalledWith(
      "/chat/completions",
      expect.any(Object),
      2,
    );
  });

  it("should handle default model", async () => {
    const requestBody = {
      model: "default",
      messages: [{ role: "user", content: "Hello" }],
    };

    const request = new Request("https://example.com/chat/completions", {
      method: "POST",
      body: JSON.stringify(requestBody),
      headers: { "Content-Type": "application/json" },
    });

    mockProviderClass.buildChatCompletionsRequest.mockReturnValue([
      "/chat/completions",
      {
        method: "POST",
        body: JSON.stringify({ ...requestBody, model: "gpt-4" }),
      },
    ]);
    mockProviderClass.fetch.mockResolvedValue(new Response());

    await handleChatCompletionsRequest({ request } as any);

    expect(Config.defaultModel).toHaveBeenCalled();
    expect(mockProviderClass.buildChatCompletionsRequest).toHaveBeenCalledWith({
      body: "",
      preparedData: { ...requestBody, model: "gpt-4" },
      headers: expect.any(Headers),
      apiKeyIndex: 0,
    });
  });

  it("should return 400 for invalid JSON", async () => {
    const request = new Request("https://example.com/chat/completions", {
      method: "POST",
      body: "invalid json",
      headers: { "Content-Type": "application/json" },
    });

    const response = await handleChatCompletionsRequest({ request } as any);

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("Invalid request.");
  });

  it.each([
    [JSON.stringify({ messages: [] }), "a missing model"],
    [JSON.stringify({ model: 42, messages: [] }), "a non-string model"],
  ])("should return 400 for %s", async (body) => {
    const response = await handleChatCompletionsRequest({
      request: new Request("https://example.com/chat/completions", {
        method: "POST",
        body,
      }),
    } as any);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request." });
  });

  it("should return 400 when the default model is absent", async () => {
    vi.mocked(Config.defaultModel).mockReturnValue(undefined);
    const response = await handleChatCompletionsRequest({
      request: new Request("https://example.com/chat/completions", {
        method: "POST",
        body: JSON.stringify({ model: "default", messages: [] }),
      }),
    } as any);

    expect(response.status).toBe(400);
  });

  it("should return 400 for invalid provider", async () => {
    const requestBody = {
      model: "invalid-provider/model",
      messages: [{ role: "user", content: "Hello" }],
    };

    const request = new Request("https://example.com/chat/completions", {
      method: "POST",
      body: JSON.stringify(requestBody),
      headers: { "Content-Type": "application/json" },
    });

    const response = await handleChatCompletionsRequest({ request } as any);

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("Invalid provider.");
  });

  it("rejects a Gateway-only provider when no Gateway is active", async () => {
    const gatewayOnlyProvider = {
      ...mockProviderClass,
      requiresAiGateway: true,
      requiresAuthenticatedAiGateway: true,
      fetch: vi.fn(),
    };
    const request = new Request("https://example.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: "google-vertex-ai/google/gemini-2.5-flash",
        messages: [],
      }),
    });
    const response = await handleChatCompletionsRequest({
      request,
      providers: { get: vi.fn(() => gatewayOnlyProvider) },
    } as any);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "google-vertex-ai requires Cloudflare AI Gateway.",
    });
    expect(gatewayOnlyProvider.fetch).not.toHaveBeenCalled();
  });

  it("rejects Vertex when the Gateway is not authenticated", async () => {
    const gatewayOnlyProvider = {
      ...mockProviderClass,
      requiresAiGateway: true,
      requiresAuthenticatedAiGateway: true,
      fetch: vi.fn(),
    };
    const request = new Request("https://example.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: "google-vertex-ai/google/gemini-2.5-flash",
        messages: [],
      }),
    });
    const buildChatCompletionsRequests = vi.fn();

    const response = await handleChatCompletionsRequest(
      {
        request,
        providers: { get: vi.fn(() => gatewayOnlyProvider) },
      } as any,
      { apiKey: undefined, buildChatCompletionsRequests } as any,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "google-vertex-ai requires CF_AIG_TOKEN.",
    });
    expect(buildChatCompletionsRequests).not.toHaveBeenCalled();
    expect(gatewayOnlyProvider.fetch).not.toHaveBeenCalled();
  });

  it("should use AI Gateway when available and provider supported", async () => {
    const requestBody = {
      model: "openai/gpt-4",
      messages: [{ role: "user", content: "Hello" }],
    };

    const request = new Request("https://example.com/chat/completions", {
      method: "POST",
      body: JSON.stringify(requestBody),
      headers: {
        "Content-Type": "application/json",
        "cf-aig-skip-cache": "true",
      },
    });

    mockProviderClass.buildChatCompletionsRequest.mockReturnValue([
      "/chat/completions",
      {
        method: "POST",
        body: JSON.stringify({ ...requestBody, model: "gpt-4" }),
      },
    ]);
    mockAIGateway.buildChatCompletionsRequests.mockReturnValue([
      [
        "https://gateway.ai.cloudflare.com/v1/account/gateway/compat/chat/completions",
        { method: "POST", body: JSON.stringify(requestBody) },
      ],
    ]);

    await handleChatCompletionsRequest(
      { request } as any,
      mockAIGateway as any,
    );

    expect(CloudflareAIGateway.isSupportedProvider).toHaveBeenCalledWith(
      "openai",
      true,
    );
    expect(
      mockProviderClass.buildChatCompletionsRequest.mock.calls[0][0].headers.get(
        "cf-aig-skip-cache",
      ),
    ).toBe("true");
    expect(mockAIGateway.buildChatCompletionsRequests).toHaveBeenCalledWith({
      provider: "openai",
      body: JSON.stringify({ ...requestBody, model: "gpt-4" }),
      parsedBody: { ...requestBody, model: "gpt-4" },
      headers: expect.any(Object),
      apiKeys: ["test-key"],
    });
    expect(helpers.fetchWithLogging).toHaveBeenCalledWith(
      "https://gateway.ai.cloudflare.com/v1/account/gateway/compat/chat/completions",
      expect.objectContaining({ signal: request.signal }),
    );
  });

  it("uses a provider-native AI Gateway chat request for Azure OpenAI", async () => {
    const request = new Request("https://example.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: "azure-openai/gpt-4o",
        messages: [{ role: "user", content: "Hello" }],
      }),
    });
    const requestWithoutNativeHeaders = request.clone();
    const providerRequest: [string, RequestInit] = [
      "/resource/gpt-4o/chat/completions?api-version=2024-10-21",
      {
        method: "POST",
        body: JSON.stringify({ messages: [] }),
        headers: { "api-key": "azure-key" },
      },
    ];
    const azureProvider = {
      apiKeyName: "AZURE_OPENAI_API_KEY",
      getApiKeys: vi.fn().mockReturnValue(["azure-key"]),
      getNextApiKeyIndex: vi.fn().mockResolvedValue(0),
      filterSupportedChatParameters: vi.fn(
        (data: Record<string, unknown>) => data,
      ),
      buildChatCompletionsRequest: vi
        .fn()
        .mockResolvedValue([
          "/chat/completions",
          { method: "POST", body: JSON.stringify({ model: "gpt-4o" }) },
        ]),
      buildAiGatewayChatCompletionsRequest: vi
        .fn()
        .mockResolvedValue(providerRequest),
      fetch: vi.fn(),
    };
    vi.mocked(CloudflareAIGateway.isSupportedProvider).mockImplementation(
      (_provider, compatibility) => !compatibility,
    );
    const buildProviderEndpointRequest = vi
      .fn()
      .mockReturnValue([
        "https://gateway.example/azure-openai/resource/gpt-4o/chat/completions",
        { method: "POST" },
      ]);
    vi.mocked(helpers.fetchWithLogging).mockResolvedValue(new Response("ok"));

    const response = await handleChatCompletionsRequest(
      {
        request,
        providers: { get: vi.fn(() => azureProvider) },
      } as any,
      { buildProviderEndpointRequest } as any,
    );

    expect(
      azureProvider.buildAiGatewayChatCompletionsRequest,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ model: "gpt-4o" }),
        apiKeyIndex: 0,
      }),
    );
    expect(buildProviderEndpointRequest).toHaveBeenCalledWith({
      provider: "azure-openai",
      method: "POST",
      path: providerRequest[0],
      body: providerRequest[1].body,
      headers: providerRequest[1].headers,
    });
    expect(await response.text()).toBe("ok");
    expect(azureProvider.fetch).not.toHaveBeenCalled();

    providerRequest[1].headers = undefined;
    await handleChatCompletionsRequest(
      {
        request: requestWithoutNativeHeaders,
        providers: { get: vi.fn(() => azureProvider) },
      } as any,
      { buildProviderEndpointRequest } as any,
    );
    expect(buildProviderEndpointRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({ headers: {} }),
    );
  });

  it("uses the direct endpoint when no native Gateway request is available", async () => {
    const request = new Request("https://example.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "openai/gpt-4", messages: [] }),
    });
    const provider = {
      ...mockProviderClass,
      buildAiGatewayChatCompletionsRequest: vi
        .fn()
        .mockResolvedValue(undefined),
    };
    provider.buildChatCompletionsRequest.mockReturnValue([
      "/chat/completions",
      { method: "POST", body: JSON.stringify({ model: "gpt-4" }) },
    ]);
    provider.fetch.mockResolvedValue(new Response());
    vi.mocked(CloudflareAIGateway.isSupportedProvider)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    await handleChatCompletionsRequest(
      { request, providers: { get: vi.fn(() => provider) } } as any,
      mockAIGateway as any,
    );

    expect(provider.buildAiGatewayChatCompletionsRequest).toHaveBeenCalled();
    expect(provider.fetch).toHaveBeenCalled();
  });

  it("should remove all proxy authorization headers", async () => {
    const requestBody = {
      model: "openai/gpt-4",
      messages: [{ role: "user", content: "Hello" }],
    };

    const request = new Request("https://example.com/chat/completions", {
      method: "POST",
      body: JSON.stringify(requestBody),
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
        "x-api-key": "test-token",
        "x-goog-api-key": "test-token",
        "x-client-header": "preserved",
      },
    });

    mockProviderClass.buildChatCompletionsRequest.mockReturnValue([
      "/chat/completions",
      {
        method: "POST",
        body: JSON.stringify({ ...requestBody, model: "gpt-4" }),
      },
    ]);
    mockProviderClass.fetch.mockResolvedValue(new Response());

    await handleChatCompletionsRequest({ request } as any);

    const headersArg =
      mockProviderClass.buildChatCompletionsRequest.mock.calls[0][0].headers;
    expect(headersArg.has("Authorization")).toBe(false);
    expect(headersArg.has("x-api-key")).toBe(false);
    expect(headersArg.has("x-goog-api-key")).toBe(false);
    expect(headersArg.get("x-client-header")).toBe("preserved");
    expect(mockProviderClass.fetch).toHaveBeenCalledWith(
      "/chat/completions",
      expect.objectContaining({ signal: request.signal }),
      0,
    );
  });

  it("should handle complex model names with multiple slashes", async () => {
    const requestBody = {
      model: "openai/gpt-4/turbo",
      messages: [{ role: "user", content: "Hello" }],
    };

    const request = new Request("https://example.com/chat/completions", {
      method: "POST",
      body: JSON.stringify(requestBody),
      headers: { "Content-Type": "application/json" },
    });

    mockProviderClass.buildChatCompletionsRequest.mockReturnValue([
      "/chat/completions",
      {
        method: "POST",
        body: JSON.stringify({ ...requestBody, model: "gpt-4/turbo" }),
      },
    ]);
    mockProviderClass.fetch.mockResolvedValue(new Response());

    await handleChatCompletionsRequest({ request } as any);

    expect(mockProviderClass.buildChatCompletionsRequest).toHaveBeenCalledWith({
      body: "",
      preparedData: { ...requestBody, model: "gpt-4/turbo" },
      headers: expect.any(Headers),
      apiKeyIndex: 0,
    });
  });
});
