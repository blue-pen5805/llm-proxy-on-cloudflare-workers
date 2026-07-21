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
    baseUrl: vi.fn(() => "https://api.example.com"),
    buildChatCompletionsRequest: vi.fn(),
    transformChatCompletionsResponse: vi.fn(
      async (response: Response) => response,
    ),
    filterSupportedChatParameters: vi.fn(
      (data: Record<string, unknown>) => data,
    ),
    fetch: vi.fn(),
    headers: vi.fn(async () => ({ "x-provider-auth": "provider-header" })),
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
    vi.mocked(helpers.shuffleArray).mockImplementation((values) => [...values]);
    vi.mocked(helpers.fetchWithLogging).mockResolvedValue(new Response());
    vi.mocked(CloudflareAIGateway.isSupportedProvider).mockReturnValue(true);
    BUILT_IN_PROVIDER_CONSTRUCTORS.openai = vi.fn(function () {
      return mockProviderClass;
    });
    vi.mocked(Config.defaultModel).mockReturnValue("openai/gpt-4");
    vi.mocked(Secrets.getAll).mockReturnValue(["test-key"]);
    vi.mocked(Secrets.getNext).mockResolvedValue(0);
    mockProviderClass.getApiKeys.mockReturnValue(["test-key"]);
    mockProviderClass.getNextApiKeyIndex.mockResolvedValue(0);

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
    expect(
      mockProviderClass.transformChatCompletionsResponse,
    ).toHaveBeenCalledOnce();
  });

  it("routes a named credential profile without forwarding it in the model", async () => {
    const request = new Request("https://example.com/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "ollama:paid/gpt-oss-120b", messages: [] }),
    });
    mockProviderClass.buildChatCompletionsRequest.mockReturnValue([
      "/chat/completions",
      { method: "POST" },
    ]);
    mockProviderClass.fetch.mockResolvedValue(new Response());
    const providers = { get: vi.fn(() => mockProviderClass) };

    await handleChatCompletionsRequest({ request, providers } as any);

    expect(providers.get).toHaveBeenCalledWith("ollama:paid");
    expect(
      mockProviderClass.filterSupportedChatParameters,
    ).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-oss-120b" }));
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
    // The Compatibility Endpoint serializes its own body, so the provider
    // request builder is not invoked; its header merge is reproduced inline.
    expect(
      mockProviderClass.buildChatCompletionsRequest,
    ).not.toHaveBeenCalled();
    const gatewayHeaders =
      mockAIGateway.buildChatCompletionsRequests.mock.calls[0][0].headers;
    expect(gatewayHeaders["cf-aig-skip-cache"]).toBe("true");
    expect(gatewayHeaders["x-provider-auth"]).toBe("provider-header");
    expect(mockAIGateway.buildChatCompletionsRequests).toHaveBeenCalledWith({
      provider: "openai",
      body: "",
      parsedBody: { ...requestBody, model: "gpt-4" },
      headers: expect.any(Object),
      apiKeys: ["test-key"],
    });
    expect(helpers.fetchWithLogging).toHaveBeenCalledWith(
      "https://gateway.ai.cloudflare.com/v1/account/gateway/compat/chat/completions",
      expect.objectContaining({ signal: request.signal }),
    );
  });

  it("uses a Custom Provider without direct fallback in strict mode", async () => {
    const requestBody = { model: "ollama/model-a", messages: [] };
    const request = new Request("https://example.com/chat/completions", {
      method: "POST",
      body: JSON.stringify(requestBody),
      headers: { "cf-aig-skip-cache": "true" },
    });
    const provider = {
      ...mockProviderClass,
      chatCompletionPath: "/chat/completions",
      pathnamePrefix: vi.fn(() => "/v1"),
      requiresCustomAiGatewayProvider: false,
      buildAiGatewayChatCompletionsRequest: vi.fn(),
    };
    provider.buildChatCompletionsRequest.mockReturnValue([
      "/chat/completions",
      {
        method: "POST",
        body: JSON.stringify({ ...requestBody, model: "model-a" }),
        headers: { "Content-Type": "application/json" },
      },
    ]);
    vi.mocked(CloudflareAIGateway.isSupportedProvider).mockReturnValue(false);
    const buildProviderEndpointRequest = vi
      .fn()
      .mockReturnValue([
        "https://gateway.example/custom-llm-proxy-ollama/v1/chat/completions",
        { method: "POST" },
      ]);

    await handleChatCompletionsRequest(
      { request, providers: { get: vi.fn(() => provider) } } as any,
      {
        alwaysUse: true,
        buildProviderEndpointRequest,
      } as any,
    );

    expect(buildProviderEndpointRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "custom-llm-proxy-ollama",
        path: "/v1/chat/completions",
      }),
    );
    expect(provider.fetch).not.toHaveBeenCalled();
    expect(helpers.fetchWithLogging).toHaveBeenCalled();
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
      transformChatCompletionsResponse: vi.fn(
        async (response: Response) => response,
      ),
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

  describe("virtual models", () => {
    function buildRequest(model: string) {
      return new Request("https://example.com/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "Hello" }],
        }),
        headers: { "Content-Type": "application/json" },
      });
    }

    it("returns the first candidate's response when it succeeds", async () => {
      vi.mocked(Config.virtualModels).mockReturnValue({
        "virtual/fast-tier": [
          { model: "openai/gpt-4", retries: 0 },
          { model: "openai/gpt-3.5", retries: 0 },
        ],
      });
      mockProviderClass.buildChatCompletionsRequest.mockResolvedValue([
        "/chat/completions",
        { method: "POST", body: "{}" },
      ]);
      mockProviderClass.fetch.mockResolvedValue(
        new Response("ok", { status: 200 }),
      );

      const response = await handleChatCompletionsRequest({
        request: buildRequest("virtual/fast-tier"),
      } as any);

      expect(await response.text()).toBe("ok");
      expect(mockProviderClass.fetch).toHaveBeenCalledTimes(1);
    });

    it("applies a candidate timeout signal to the upstream fetch", async () => {
      vi.mocked(Config.virtualModels).mockReturnValue({
        "virtual/fast-tier": [
          { model: "openai/gpt-4", retries: 0, timeout: 5000 },
        ],
      });
      mockProviderClass.buildChatCompletionsRequest.mockResolvedValue([
        "/chat/completions",
        { method: "POST", body: "{}" },
      ]);
      mockProviderClass.fetch.mockResolvedValue(new Response("ok"));
      const request = buildRequest("virtual/fast-tier");

      const response = await handleChatCompletionsRequest({ request } as any);

      const fetchSignal = mockProviderClass.fetch.mock.calls[0]?.[1]?.signal;
      expect(await response.text()).toBe("ok");
      expect(fetchSignal).toBeInstanceOf(AbortSignal);
      expect(fetchSignal).not.toBe(request.signal);
      expect(fetchSignal?.aborted).toBe(false);
    });

    it("fails over to the next candidate on a retryable status", async () => {
      vi.mocked(Config.virtualModels).mockReturnValue({
        "virtual/fast-tier": [
          { model: "openai/gpt-4", retries: 0 },
          { model: "openai/gpt-3.5", retries: 0 },
        ],
      });
      mockProviderClass.buildChatCompletionsRequest.mockResolvedValue([
        "/chat/completions",
        { method: "POST", body: "{}" },
      ]);
      mockProviderClass.fetch
        .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
        .mockResolvedValueOnce(new Response("ok", { status: 200 }));

      const response = await handleChatCompletionsRequest({
        request: buildRequest("virtual/fast-tier"),
      } as any);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("ok");
      expect(mockProviderClass.fetch).toHaveBeenCalledTimes(2);
    });

    it("selects a provider key again for each configured retry", async () => {
      vi.mocked(Config.virtualModels).mockReturnValue({
        "virtual/fast-tier": [{ model: "openai/gpt-4", retries: 1 }],
      });
      mockProviderClass.getApiKeys.mockReturnValue(["key-0", "key-1"]);
      mockProviderClass.getNextApiKeyIndex
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1);
      mockProviderClass.buildChatCompletionsRequest.mockResolvedValue([
        "/chat/completions",
        { method: "POST", body: "{}" },
      ]);
      mockProviderClass.fetch
        .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
        .mockResolvedValueOnce(new Response("ok", { status: 200 }));

      const response = await handleChatCompletionsRequest({
        request: buildRequest("virtual/fast-tier"),
      } as any);

      expect(await response.text()).toBe("ok");
      expect(mockProviderClass.getNextApiKeyIndex).toHaveBeenCalledTimes(2);
      expect(
        mockProviderClass.buildChatCompletionsRequest.mock.calls.map(
          ([options]) => options.apiKeyIndex,
        ),
      ).toEqual([0, 1]);
    });

    it("does not fail over on a non-retryable client error", async () => {
      vi.mocked(Config.virtualModels).mockReturnValue({
        "virtual/fast-tier": [
          { model: "openai/gpt-4", retries: 0 },
          { model: "openai/gpt-3.5", retries: 0 },
        ],
      });
      mockProviderClass.buildChatCompletionsRequest.mockResolvedValue([
        "/chat/completions",
        { method: "POST", body: "{}" },
      ]);
      mockProviderClass.fetch.mockResolvedValue(
        new Response("bad request", { status: 400 }),
      );

      const response = await handleChatCompletionsRequest({
        request: buildRequest("virtual/fast-tier"),
      } as any);

      expect(response.status).toBe(400);
      expect(mockProviderClass.fetch).toHaveBeenCalledTimes(1);
    });

    it("returns the last candidate's response once every candidate fails", async () => {
      vi.mocked(Config.virtualModels).mockReturnValue({
        "virtual/fast-tier": [
          { model: "openai/gpt-4", retries: 0 },
          { model: "openai/gpt-3.5", retries: 0 },
        ],
      });
      mockProviderClass.buildChatCompletionsRequest.mockResolvedValue([
        "/chat/completions",
        { method: "POST", body: "{}" },
      ]);
      mockProviderClass.fetch.mockResolvedValue(
        new Response("unavailable", { status: 503 }),
      );

      const response = await handleChatCompletionsRequest({
        request: buildRequest("virtual/fast-tier"),
      } as any);

      expect(response.status).toBe(503);
      expect(mockProviderClass.fetch).toHaveBeenCalledTimes(2);
    });

    it("returns 400 for an unknown virtual model", async () => {
      vi.mocked(Config.virtualModels).mockReturnValue({
        "virtual/fast-tier": [{ model: "openai/gpt-4", retries: 0 }],
      });

      const response = await handleChatCompletionsRequest({
        request: buildRequest("virtual/unknown-route"),
      } as any);

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid provider." });
      expect(mockProviderClass.fetch).not.toHaveBeenCalled();
    });

    it("returns 400 when no virtual models are configured", async () => {
      vi.mocked(Config.virtualModels).mockReturnValue(undefined);

      const response = await handleChatCompletionsRequest({
        request: buildRequest("virtual/fast-tier"),
      } as any);

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid provider." });
    });

    it("resolves a virtual model keyed outside the virtual/ convention", async () => {
      vi.mocked(Config.virtualModels).mockReturnValue({
        "group/fast": [{ model: "openai/gpt-4", retries: 0 }],
      });
      mockProviderClass.buildChatCompletionsRequest.mockResolvedValue([
        "/chat/completions",
        { method: "POST", body: "{}" },
      ]);
      mockProviderClass.fetch.mockResolvedValue(
        new Response("ok", { status: 200 }),
      );

      const response = await handleChatCompletionsRequest({
        request: buildRequest("group/fast"),
      } as any);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("ok");
      expect(mockProviderClass.fetch).toHaveBeenCalledTimes(1);
    });

    it("prefers a real provider over a colliding virtual model key", async () => {
      // "openai" is a real provider, so the virtual key is shadowed and its
      // candidate (the unknown "groq" provider) is never reached.
      vi.mocked(Config.virtualModels).mockReturnValue({
        "openai/gpt-4": [{ model: "groq/other", retries: 0 }],
      });
      mockProviderClass.buildChatCompletionsRequest.mockResolvedValue([
        "/chat/completions",
        { method: "POST", body: "{}" },
      ]);
      mockProviderClass.fetch.mockResolvedValue(
        new Response("ok", { status: 200 }),
      );

      const response = await handleChatCompletionsRequest({
        request: buildRequest("openai/gpt-4"),
      } as any);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("ok");
      expect(Config.virtualModels).not.toHaveBeenCalled();
    });
  });
});
