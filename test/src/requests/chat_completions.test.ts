import { describe, it, expect, vi, beforeEach } from "vitest";
import { CloudflareAIGateway } from "~/src/ai_gateway";
import { BUILT_IN_PROVIDER_CONSTRUCTORS } from "~/src/providers";
import { handleChatCompletionsRequest } from "~/src/requests/chat_completions";
import { Config } from "~/src/utils/config";
import * as helpers from "~/src/utils/helpers";
import { RequestLogger } from "~/src/utils/logger";
import { Secrets } from "~/src/utils/secrets";
import { createTestRoutedContext } from "../../helpers/request_context";

vi.mock("~/src/ai_gateway");
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
    vi.mocked(helpers.readResponseJson).mockImplementation((response) =>
      response.json(),
    );
    vi.mocked(helpers.shuffleArray).mockImplementation((values) => [...values]);
    vi.mocked(helpers.fetchWithLogging).mockResolvedValue(new Response());
    vi.mocked(CloudflareAIGateway.isSupportedProvider).mockReturnValue(true);
    BUILT_IN_PROVIDER_CONSTRUCTORS.openai = vi.fn(function () {
      return mockProviderClass;
    }) as unknown as (typeof BUILT_IN_PROVIDER_CONSTRUCTORS)[string];
    vi.mocked(Config.defaultModel).mockReturnValue("openai/gpt-4");
    vi.mocked(Config.chatResponseMetadataEnabled).mockReturnValue(false);
    vi.mocked(Secrets.getAll).mockReturnValue(["test-key"]);
    vi.mocked(Secrets.getNext).mockResolvedValue(0);
    mockProviderClass.getApiKeys.mockReturnValue(["test-key"]);
    mockProviderClass.getNextApiKeyIndex.mockResolvedValue(0);
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

  it("starts logging with the resolved endpoint, provider, and model", async () => {
    const request = new Request("https://example.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: "openai:paid/gpt-4",
        messages: [],
      }),
      headers: { "cf-ray": "abcdef123456" },
    });
    mockProviderClass.buildChatCompletionsRequest.mockReturnValue([
      "/chat/completions",
      { method: "POST" },
    ]);
    mockProviderClass.fetch.mockResolvedValue(new Response());
    const providers = { get: vi.fn(() => mockProviderClass) };
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});

    await RequestLogger.run(request, () =>
      handleChatCompletionsRequest({ request, providers } as any),
    );

    expect(consoleInfo).toHaveBeenNthCalledWith(1, {
      event: "request.started",
      request_id: "abcdef123456",
      method: "POST",
      path: "/v1/chat/completions",
      endpoint: "chat_completions",
      provider: "openai",
      credential_profile: "paid",
      model: "gpt-4",
      message:
        "[abcdef12] Request started: method=POST, path=/v1/chat/completions, endpoint=chat_completions, provider=openai, credential_profile=paid, model=gpt-4",
    });
  });

  it.each(["openai", "openai/"])(
    "omits an empty routed model from request start logging for %s",
    async (requestedModel) => {
      const request = new Request("https://example.com/v1/chat/completions", {
        method: "POST",
        body: JSON.stringify({ model: requestedModel, messages: [] }),
        headers: { "cf-ray": "abcdef123456" },
      });
      mockProviderClass.buildChatCompletionsRequest.mockReturnValue([
        "/chat/completions",
        { method: "POST" },
      ]);
      mockProviderClass.fetch.mockResolvedValue(new Response());
      const consoleInfo = vi
        .spyOn(console, "info")
        .mockImplementation(() => {});

      await RequestLogger.run(request, () =>
        handleChatCompletionsRequest(createTestRoutedContext({ request })),
      );

      const startRecord = consoleInfo.mock.calls
        .map(([record]) => record)
        .find(
          (record) =>
            (record as Record<string, unknown>).event === "request.started",
        ) as Record<string, unknown>;
      expect(startRecord).toMatchObject({
        endpoint: "chat_completions",
        provider: "openai",
      });
      expect(startRecord).not.toHaveProperty("model");
      expect(startRecord.message).not.toContain("model=");
    },
  );

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

  it("preserves the upstream JSON body when response metadata is disabled", async () => {
    const upstreamBody = { id: "chatcmpl-test", choices: [] };
    const request = new Request("https://example.com/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "openai/gpt-4", messages: [] }),
    });
    mockProviderClass.buildChatCompletionsRequest.mockResolvedValue([
      "/chat/completions",
      { method: "POST", body: "{}" },
    ]);
    mockProviderClass.fetch.mockResolvedValue(Response.json(upstreamBody));

    const response = await handleChatCompletionsRequest(
      createTestRoutedContext({ request }),
    );

    expect(await response.json()).toEqual(upstreamBody);
  });

  it("adds llm_proxy metadata when response metadata is enabled", async () => {
    vi.mocked(Config.chatResponseMetadataEnabled).mockReturnValue(true);
    const request = new Request("https://example.com/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "openai/gpt-4", messages: [] }),
    });
    mockProviderClass.buildChatCompletionsRequest.mockResolvedValue([
      "/chat/completions",
      { method: "POST", body: "{}" },
    ]);
    mockProviderClass.fetch.mockResolvedValue(
      Response.json({ id: "chatcmpl-test", choices: [] }),
    );

    const response = await handleChatCompletionsRequest(
      createTestRoutedContext({ request }),
    );
    const body = (await response.json()) as Record<string, any>;

    expect(body.id).toBe("chatcmpl-test");
    expect(body.llm_proxy).toMatchObject({
      provider: "openai",
      model: "gpt-4",
      requested_model: "openai/gpt-4",
      credential_profile: "default",
      credential_index: 0,
      via_ai_gateway: false,
    });
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

    await handleChatCompletionsRequest(
      createTestRoutedContext({
        request,
        apiKeyIndex: { start: 1, end: 2 },
      }),
    );

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

    await handleChatCompletionsRequest(createTestRoutedContext({ request }));

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

    const response = await handleChatCompletionsRequest(
      createTestRoutedContext({ request }),
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: { message: string };
    };
    expect(body.error.message).toBe("Invalid request.");
  });

  it.each([
    [JSON.stringify({ messages: [] }), "a missing model"],
    [JSON.stringify({ model: 42, messages: [] }), "a non-string model"],
  ])("should return 400 for %s", async (body) => {
    const response = await handleChatCompletionsRequest(
      createTestRoutedContext({
        request: new Request("https://example.com/chat/completions", {
          method: "POST",
          body,
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: expect.objectContaining({ message: "Invalid request." }),
    });
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

    const response = await handleChatCompletionsRequest(
      createTestRoutedContext({ request }),
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: { message: string };
    };
    expect(body.error.message).toBe("Invalid provider.");
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

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: expect.objectContaining({
        message: "google-vertex-ai requires Cloudflare AI Gateway.",
      }),
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

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: expect.objectContaining({
        message: "google-vertex-ai requires CF_AIG_TOKEN.",
      }),
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
      createTestRoutedContext({ request }),
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
    expect(new Headers(gatewayHeaders).get("cf-aig-skip-cache")).toBe("true");
    expect(new Headers(gatewayHeaders).get("x-provider-auth")).toBe(
      "provider-header",
    );
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

  it("tags each AI Gateway credential fallback with its actual provider key index", async () => {
    const request = new Request("https://example.com/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "openai/gpt-4", messages: [] }),
    });
    mockProviderClass.getApiKeys.mockReturnValue(["key-0", "key-1"]);
    mockAIGateway.buildChatCompletionsRequests.mockImplementation(
      ({ headers, apiKeys }) =>
        apiKeys.map((_apiKey: string, index: number) => [
          `https://gateway.example/attempt-${index}`,
          { method: "POST", headers: new Headers(headers) },
        ]),
    );
    vi.mocked(helpers.fetchWithLogging)
      .mockRejectedValueOnce(new Error("network failure"))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const response = await handleChatCompletionsRequest(
      createTestRoutedContext({ request }),
      mockAIGateway as any,
    );

    expect(response.status).toBe(200);
    const providerKeyIndexes = vi
      .mocked(helpers.fetchWithLogging)
      .mock.calls.map(([, init]) => {
        const metadata = JSON.parse(
          new Headers(init?.headers).get("cf-aig-metadata")!,
        ) as Record<string, string>;
        return Number(metadata.llm_proxy_credentials.split(":")[1]);
      });
    expect(providerKeyIndexes).toEqual([0, 1]);
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
      getApiKeys: vi.fn().mockReturnValue([]),
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
    const metadata = JSON.parse(
      new Headers(
        provider.buildChatCompletionsRequest.mock.calls[0][0].headers,
      ).get("cf-aig-metadata")!,
    ) as Record<string, string>;
    expect(metadata.llm_proxy_credentials).toBe("default:null");
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

    await handleChatCompletionsRequest(createTestRoutedContext({ request }));

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

    await handleChatCompletionsRequest(createTestRoutedContext({ request }));

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

      const response = await handleChatCompletionsRequest(
        createTestRoutedContext({ request: buildRequest("virtual/fast-tier") }),
      );

      expect(await response.text()).toBe("ok");
      expect(mockProviderClass.fetch).toHaveBeenCalledTimes(1);
    });

    it("resolves a virtual model candidate through another virtual model", async () => {
      vi.mocked(Config.virtualModels).mockReturnValue({
        "virtual/front": [
          { model: "virtual/fallback", retries: 0, timeout: 5000 },
        ],
        "virtual/fallback": [
          { model: "missing/model", retries: 0 },
          { model: "openai/gpt-4", retries: 0 },
        ],
      });
      mockProviderClass.buildChatCompletionsRequest.mockResolvedValue([
        "/chat/completions",
        { method: "POST", body: "{}" },
      ]);
      mockProviderClass.fetch.mockResolvedValue(new Response("nested ok"));

      const response = await handleChatCompletionsRequest(
        createTestRoutedContext({ request: buildRequest("virtual/front") }),
      );

      expect(await response.text()).toBe("nested ok");
      expect(mockProviderClass.fetch).toHaveBeenCalledOnce();
      expect(mockProviderClass.fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(
        AbortSignal,
      );
    });

    it("adds enabled metadata for the selected virtual-model candidate", async () => {
      vi.mocked(Config.chatResponseMetadataEnabled).mockReturnValue(true);
      vi.mocked(Config.virtualModels).mockReturnValue({
        "virtual/fast-tier": [{ model: "openai/gpt-4", retries: 0 }],
      });
      mockProviderClass.buildChatCompletionsRequest.mockResolvedValue([
        "/chat/completions",
        { method: "POST", body: "{}" },
      ]);
      mockProviderClass.fetch.mockResolvedValue(
        Response.json({ id: "chatcmpl-virtual", choices: [] }),
      );

      const response = await handleChatCompletionsRequest(
        createTestRoutedContext({ request: buildRequest("virtual/fast-tier") }),
      );

      await expect(response.json()).resolves.toMatchObject({
        id: "chatcmpl-virtual",
        llm_proxy: {
          provider: "openai",
          model: "gpt-4",
          requested_model: "virtual/fast-tier",
        },
      });
    });

    it("defensively rejects a cycle that bypassed configuration validation", async () => {
      vi.mocked(Config.virtualModels).mockReturnValue({
        "virtual/one": [{ model: "virtual/two", retries: 0 }],
        "virtual/two": [{ model: "virtual/one", retries: 0 }],
      });

      await expect(
        handleChatCompletionsRequest(
          createTestRoutedContext({ request: buildRequest("virtual/one") }),
        ),
      ).rejects.toThrow("Invalid configuration for VIRTUAL_MODELS.");
      expect(mockProviderClass.fetch).not.toHaveBeenCalled();
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

      const response = await handleChatCompletionsRequest(
        createTestRoutedContext({ request }),
      );

      const fetchSignal = mockProviderClass.fetch.mock.calls[0]?.[1]?.signal;
      expect(await response.text()).toBe("ok");
      expect(fetchSignal).toBeInstanceOf(AbortSignal);
      expect(fetchSignal).not.toBe(request.signal);
      expect(fetchSignal?.aborted).toBe(false);
    });

    it("adds the client-requested virtual model to AI Gateway metadata", async () => {
      vi.mocked(Config.virtualModels).mockReturnValue({
        "virtual/front": [{ model: "virtual/fallback", retries: 0 }],
        "virtual/fallback": [{ model: "openai/gpt-4", retries: 0 }],
      });
      mockAIGateway.buildChatCompletionsRequests.mockImplementation(
        ({ headers }) => [
          [
            "https://gateway.ai.cloudflare.com/v1/account/gateway/compat/chat/completions",
            { method: "POST", body: "{}", headers: new Headers(headers) },
          ],
        ],
      );

      await handleChatCompletionsRequest(
        createTestRoutedContext({ request: buildRequest("virtual/front") }),
        mockAIGateway as any,
      );

      const headers = new Headers(
        vi.mocked(helpers.fetchWithLogging).mock.calls[0][1]?.headers,
      );
      const metadata = JSON.parse(headers.get("cf-aig-metadata")!) as Record<
        string,
        string
      >;
      expect(metadata).toMatchObject({
        llm_proxy_provider: "openai",
        llm_proxy_model: "gpt-4",
        llm_proxy_endpoint: "chat_completions",
        llm_proxy_virtual_model: "virtual/front",
      });
      expect(metadata.llm_proxy_credentials).toBe("default:0");
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

      const response = await handleChatCompletionsRequest(
        createTestRoutedContext({ request: buildRequest("virtual/fast-tier") }),
      );

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

      const response = await handleChatCompletionsRequest(
        createTestRoutedContext({ request: buildRequest("virtual/fast-tier") }),
      );

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

      const response = await handleChatCompletionsRequest(
        createTestRoutedContext({ request: buildRequest("virtual/fast-tier") }),
      );

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

      const response = await handleChatCompletionsRequest(
        createTestRoutedContext({ request: buildRequest("virtual/fast-tier") }),
      );

      expect(response.status).toBe(503);
      expect(mockProviderClass.fetch).toHaveBeenCalledTimes(2);
    });

    it("returns a local candidate error without response metadata", async () => {
      vi.mocked(Config.virtualModels).mockReturnValue({
        "virtual/broken": [{ model: "unknown/model", retries: 0 }],
      });

      const response = await handleChatCompletionsRequest(
        createTestRoutedContext({ request: buildRequest("virtual/broken") }),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: expect.objectContaining({ message: "Invalid provider." }),
      });
      expect(mockProviderClass.fetch).not.toHaveBeenCalled();
    });

    it("returns 400 for an unknown virtual model", async () => {
      vi.mocked(Config.virtualModels).mockReturnValue({
        "virtual/fast-tier": [{ model: "openai/gpt-4", retries: 0 }],
      });

      const response = await handleChatCompletionsRequest(
        createTestRoutedContext({
          request: buildRequest("virtual/unknown-route"),
        }),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: expect.objectContaining({ message: "Invalid provider." }),
      });
      expect(mockProviderClass.fetch).not.toHaveBeenCalled();
    });

    it("returns 400 when no virtual models are configured", async () => {
      vi.mocked(Config.virtualModels).mockReturnValue(undefined);

      const response = await handleChatCompletionsRequest(
        createTestRoutedContext({ request: buildRequest("virtual/fast-tier") }),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: expect.objectContaining({ message: "Invalid provider." }),
      });
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

      const response = await handleChatCompletionsRequest(
        createTestRoutedContext({ request: buildRequest("group/fast") }),
      );

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("ok");
      expect(mockProviderClass.fetch).toHaveBeenCalledTimes(1);
    });

    it("resolves a virtual model key without a provider separator", async () => {
      vi.mocked(Config.virtualModels).mockReturnValue({
        fast: [{ model: "openai/gpt-4", retries: 0 }],
      });
      mockProviderClass.buildChatCompletionsRequest.mockResolvedValue([
        "/chat/completions",
        { method: "POST", body: "{}" },
      ]);
      mockProviderClass.fetch.mockResolvedValue(
        new Response("ok", { status: 200 }),
      );

      const response = await handleChatCompletionsRequest(
        createTestRoutedContext({ request: buildRequest("fast") }),
      );

      expect(response.status).toBe(200);
    });

    it("rejects a non-provider model without a separator", async () => {
      vi.mocked(Config.virtualModels).mockReturnValue(undefined);

      const response = await handleChatCompletionsRequest(
        createTestRoutedContext({ request: buildRequest("missing") }),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: expect.objectContaining({ message: "Invalid provider." }),
      });
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

      const response = await handleChatCompletionsRequest(
        createTestRoutedContext({ request: buildRequest("openai/gpt-4") }),
      );

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("ok");
      expect(Config.virtualModels).not.toHaveBeenCalled();
    });
  });
});
