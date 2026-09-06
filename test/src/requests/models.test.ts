import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CloudflareAIGateway } from "~/src/ai_gateway";
import {
  BUILT_IN_PROVIDER_CONSTRUCTORS,
  ProviderRegistry,
} from "~/src/providers";
import { PerplexityAi } from "~/src/providers/perplexity-ai/provider";
import {
  createProvider,
  type Provider,
  ProviderNotSupportedError,
} from "~/src/providers/provider";
import type { RoutedRequestContext } from "~/src/request_context";
import {
  handleModelRetrieveRequest,
  handleModelsRequest,
  MAX_AGGREGATED_MODELS_BYTES,
  MAX_MODELS_PER_PROVIDER,
  MAX_MODELS_RATE_LIMIT_KEY_ATTEMPTS,
} from "~/src/requests/models";
import { Config } from "~/src/utils/config";
import { Environments } from "~/src/utils/environments";
import * as helpers from "~/src/utils/helpers";
import { Secrets } from "~/src/utils/secrets";
import { createTestRoutedContext } from "../../helpers/request_context";

vi.mock("~/src/ai_gateway");
vi.mock("~/src/utils/helpers");
vi.mock("~/src/utils/secrets");

interface ModelData {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

interface ModelsResponse {
  object: string;
  data: ModelData[];
}

function mockProviderConstructor(instance: unknown) {
  return vi.fn(function () {
    return instance;
  }) as unknown as (typeof BUILT_IN_PROVIDER_CONSTRUCTORS)[string];
}

function registryFor(providers: Record<string, Provider>): ProviderRegistry {
  return new ProviderRegistry(
    Object.fromEntries(
      Object.entries(providers).map(([name, provider]) => [
        name,
        mockProviderConstructor(provider),
      ]),
    ),
  );
}

async function requestModels(
  overrides: Partial<RoutedRequestContext> = {},
  aiGateway?: CloudflareAIGateway,
): Promise<Response> {
  const context = createTestRoutedContext(overrides);
  const response = await handleModelsRequest(context, aiGateway);
  await waitOnExecutionContext(context.ctx);
  return response;
}

async function requestModel(
  overrides: Partial<RoutedRequestContext>,
  modelId: string,
  aiGateway?: CloudflareAIGateway,
): Promise<Response> {
  const context = createTestRoutedContext(overrides);
  const response = await handleModelRetrieveRequest(
    context,
    modelId,
    aiGateway,
  );
  await waitOnExecutionContext(context.ctx);
  return response;
}

describe("models", () => {
  const mockProviderClass = {
    ...createProvider(),
    endpoints: {
      models: {
        path: "/models",
        validate: vi.fn(),
        convertResponse: vi.fn(),
        getStaticModels: vi.fn(),
      },
    },

    available: vi.fn(),
    baseUrl: vi.fn(() => "https://api.example.com"),

    send: vi.fn(),
    headers: vi.fn(),

    getApiKeys: vi.fn().mockReturnValue(["test-key"]),
    getNextApiKeyIndex: vi.fn().mockResolvedValue(0),
  };

  const mockAIGateway = {
    buildProviderEndpointRequest: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Response caching is exercised by the dedicated "models cache" suite;
    // every other test runs against a disabled cache.
    Environments.setEnv({
      MODELS_CACHE_TTL_SECONDS: "0",
    } as unknown as Env);

    // Clear the built-in provider constructor map.
    Object.keys(BUILT_IN_PROVIDER_CONSTRUCTORS).forEach((key) => {
      delete BUILT_IN_PROVIDER_CONSTRUCTORS[key];
    });

    // Provide withTimeout implementation to the mocked helpers module
    if (helpers.withTimeout !== undefined) {
      vi.mocked(helpers.withTimeout).mockImplementation(
        async (promise: Promise<any>, _abortController: AbortController) => {
          return promise;
        },
      );
    }
    vi.mocked(helpers.readResponseJson).mockImplementation((response) =>
      response.json(),
    );
    vi.mocked(helpers.utf8ByteLength).mockImplementation(
      (value: string) => new TextEncoder().encode(value).length,
    );

    vi.mocked(helpers.fetchWithLogging).mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ data: [] }))),
    );
    vi.mocked(CloudflareAIGateway.isSupportedProvider).mockReturnValue(true);
    vi.mocked(Secrets.getAll).mockReturnValue(["test-key"]);
    vi.mocked(Secrets.getProfiles).mockReturnValue([]);
    vi.mocked(Secrets.getNext).mockResolvedValue(0);
    vi.mocked(Secrets.resolveApiKeyIndex).mockImplementation((selection) => {
      if (typeof selection === "number") {
        return selection;
      }
      return 0;
    });

    // Set up default mock providers in a specific order
    BUILT_IN_PROVIDER_CONSTRUCTORS.openai =
      mockProviderConstructor(mockProviderClass);
    BUILT_IN_PROVIDER_CONSTRUCTORS.anthropic =
      mockProviderConstructor(mockProviderClass);

    mockProviderClass.available.mockReturnValue(true);
    mockProviderClass.endpoints.models.validate.mockReturnValue([
      "/models",
      { method: "GET" },
    ]);
    mockProviderClass.endpoints.models.convertResponse.mockReturnValue({
      object: "list",
      data: [
        {
          id: "gpt-4",
          object: "model",
          created: 1234567890,
          owned_by: "openai",
        },
      ],
    });
    mockProviderClass.headers.mockReturnValue({
      "Content-Type": "application/json",
    });
    mockProviderClass.send.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ data: [] }))),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Environments.setEnv(undefined);
  });

  it("omits undeclared model discovery without upstream I/O", async () => {
    const provider = new PerplexityAi();
    const send = vi.spyOn(provider, "send");
    const response = await requestModels(
      { providers: registryFor({ "perplexity-ai": provider }) },
      mockAIGateway as any,
    );
    expect(await response.json()).toEqual({ object: "list", data: [] });
    expect(send).not.toHaveBeenCalled();
    expect(helpers.fetchWithLogging).not.toHaveBeenCalled();
  });

  it("preserves OpenAI model metadata without a provider conversion hook", async () => {
    const provider = createProvider({
      endpoints: { models: { path: "/models" } },
      available: () => true,
    });
    const send = vi.spyOn(provider, "send").mockResolvedValue(
      Response.json({
        object: "list",
        data: [
          {
            id: "model",
            object: "model",
            created: 0,
            owned_by: "source",
            metadata: { context: 4096 },
          },
        ],
      }),
    );
    const response = await requestModels({
      providers: registryFor({ openai: provider }),
    });
    expect(await response.json()).toMatchObject({
      object: "list",
      data: [{ id: "openai/model", metadata: { context: 4096 } }],
    });
    expect(send).toHaveBeenCalledOnce();
  });

  it("should return models from all available providers", async () => {
    const response = await requestModels({} as any);

    expect(response).toBeInstanceOf(Response);
    expect(response.headers.get("Content-Type")).toBe("application/json");

    const body = (await response.json()) as ModelsResponse;
    expect(body).toEqual({
      object: "list",
      data: [
        {
          id: "openai/gpt-4",
          object: "model",
          created: 1234567890,
          owned_by: "openai",
        },
        {
          id: "anthropic/gpt-4",
          object: "model",
          created: 1234567890,
          owned_by: "openai",
        },
      ],
    });
    expect(Secrets.getNext).not.toHaveBeenCalled();
  });

  it("filters aggregation by a canonical provider query", async () => {
    const response = await requestModels({
      request: new Request(
        "https://example.com/v1/models?provider=anthropic,anthropic",
      ),
    } as any);
    const body = (await response.json()) as ModelsResponse;
    expect(body.data.map((model) => model.id)).toEqual(["anthropic/gpt-4"]);
    expect(mockProviderClass.send).toHaveBeenCalledOnce();
  });

  it("omits virtual models when a real-provider filter is active", async () => {
    vi.spyOn(Config, "virtualModels").mockReturnValue({
      "virtual/fast": [{ model: "openai/gpt-4", retries: 0 }],
    });
    const response = await requestModels({
      request: new Request("https://example.com/v1/models?provider=openai"),
    } as any);
    const body = (await response.json()) as ModelsResponse;
    expect(body.data.some((model) => model.id === "virtual/fast")).toBe(false);
  });

  it.each([
    "provider=openai&provider=anthropic",
    "provider=",
    "provider=unknown",
    `provider=${Array.from({ length: 33 }, (_value, index) => `provider-${index}`).join(",")}`,
  ])("rejects an invalid provider query: %s", async (query) => {
    const response = await requestModels({
      request: new Request(`https://example.com/v1/models?${query}`),
    } as any);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: expect.objectContaining({
        message: expect.any(String),
        param: "provider",
      }),
    });
  });

  it("retrieves one provider-qualified model", async () => {
    const response = await requestModel(
      {
        request: new Request("https://example.com/v1/models/openai%2Fgpt-4"),
      } as any,
      "openai/gpt-4",
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: "openai/gpt-4",
      object: "model",
    });
  });

  it("returns model_not_found for an absent model", async () => {
    const response = await requestModel(
      {
        request: new Request("https://example.com/v1/models/missing"),
      } as any,
      "missing",
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: expect.objectContaining({
        code: "model_not_found",
        param: "model",
      }),
    });
  });

  it("propagates an aggregate validation error during retrieval", async () => {
    const response = await requestModel(
      {
        request: new Request(
          "https://example.com/v1/models/missing?provider=unknown",
        ),
      } as any,
      "missing",
    );
    expect(response.status).toBe(400);
  });

  it("lists configured virtual models at the front of the response", async () => {
    Environments.setEnv({
      MODELS_CACHE_TTL_SECONDS: "0",
      VIRTUAL_MODELS: JSON.stringify({
        "virtual/fast-tier": ["openai/gpt-4"],
        "group/blend": ["anthropic/claude"],
      }),
    } as unknown as Env);

    const response = await requestModels({} as any);
    const body = (await response.json()) as ModelsResponse;

    expect(body.data.slice(0, 2)).toEqual([
      {
        id: "virtual/fast-tier",
        object: "model",
        created: 0,
        owned_by: "virtual",
      },
      {
        id: "group/blend",
        object: "model",
        created: 0,
        owned_by: "virtual",
      },
    ]);
    // Provider models still follow the virtual ones.
    expect(body.data.map((model) => model.id)).toEqual([
      "virtual/fast-tier",
      "group/blend",
      "openai/gpt-4",
      "anthropic/gpt-4",
    ]);
  });

  it("omits virtual models when none are configured", async () => {
    const response = await requestModels({} as any);
    const body = (await response.json()) as ModelsResponse;

    expect(body.data.every((model) => model.owned_by !== "virtual")).toBe(true);
  });

  it("should include response parsing in the provider timeout", async () => {
    Object.keys(BUILT_IN_PROVIDER_CONSTRUCTORS).forEach((key) => {
      delete BUILT_IN_PROVIDER_CONSTRUCTORS[key];
    });

    const formattedModels = {
      object: "list",
      data: [
        {
          id: "test-model",
          object: "model",
          created: 1234567890,
          owned_by: "test",
        },
      ],
    };
    const responseJson = { data: [{ id: "test-model" }] };
    const upstreamResponse = new Response(JSON.stringify(responseJson));
    const json = vi.spyOn(upstreamResponse, "json");
    const parsingProviderClass = {
      ...mockProviderClass,
      endpoints: {
        models: {
          ...mockProviderClass.endpoints.models,
          convertResponse: vi.fn().mockReturnValue(formattedModels),
        },
      },
      send: vi.fn().mockResolvedValue(upstreamResponse),
    };

    BUILT_IN_PROVIDER_CONSTRUCTORS.test =
      mockProviderConstructor(parsingProviderClass);
    vi.mocked(CloudflareAIGateway.isSupportedProvider).mockReturnValue(false);

    const response = await requestModels({} as any);
    const [timeoutPromise, abortController, timeoutMs, providerName] =
      vi.mocked(helpers.withTimeout).mock.calls[0];

    await expect(timeoutPromise).resolves.toBe(formattedModels);
    expect(abortController).toBeInstanceOf(AbortController);
    expect(timeoutMs).toBe(60_000);
    expect(providerName).toBe("test");
    expect(json).toHaveBeenCalledOnce();
    expect(
      parsingProviderClass.endpoints.models.convertResponse,
    ).toHaveBeenCalledWith(responseJson);
    await expect(response.json()).resolves.toEqual({
      object: "list",
      data: [
        {
          id: "test/test-model",
          object: "model",
          created: 1234567890,
          owned_by: "test",
        },
      ],
    });
  });

  it("starts model discovery for every provider without batching", async () => {
    const pendingResponses: Array<(response: Response) => void> = [];
    const concurrentProvider = {
      ...mockProviderClass,
      send: vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            pendingResponses.push(resolve);
          }),
      ),
    };
    const providers = Object.fromEntries(
      Array.from({ length: 6 }, (_, index) => [
        `provider-${index}`,
        concurrentProvider,
      ]),
    );

    const responsePromise = requestModels({
      providers: registryFor(providers),
    } as any);

    await vi.waitFor(() => {
      expect(concurrentProvider.send).toHaveBeenCalledTimes(6);
    });
    for (const resolve of pendingResponses) {
      resolve(new Response(JSON.stringify({ data: [] })));
    }

    await expect(responsePromise).resolves.toBeInstanceOf(Response);
  });

  it("should skip unavailable providers", async () => {
    const unavailableProviderClass = {
      ...mockProviderClass,
      available: vi.fn().mockReturnValue(false),
    };

    // Clear and reset providers
    Object.keys(BUILT_IN_PROVIDER_CONSTRUCTORS).forEach((key) => {
      delete BUILT_IN_PROVIDER_CONSTRUCTORS[key];
    });

    BUILT_IN_PROVIDER_CONSTRUCTORS.openai =
      mockProviderConstructor(mockProviderClass);
    BUILT_IN_PROVIDER_CONSTRUCTORS.unavailable = mockProviderConstructor(
      unavailableProviderClass,
    );

    const response = await requestModels({} as any);
    const body = (await response.json()) as ModelsResponse;

    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("openai/gpt-4");
  });

  it("should skip unavailable providers that cannot list models through AI Gateway", async () => {
    const unavailableProviderClass = {
      ...mockProviderClass,
      endpoints: {
        models: {
          ...mockProviderClass.endpoints.models,
          validate: vi.fn(),
          supportsAiGateway: false,
        },
      },
      available: vi.fn().mockReturnValue(false),
    };

    Object.keys(BUILT_IN_PROVIDER_CONSTRUCTORS).forEach((key) => {
      delete BUILT_IN_PROVIDER_CONSTRUCTORS[key];
    });
    BUILT_IN_PROVIDER_CONSTRUCTORS.unavailable = mockProviderConstructor(
      unavailableProviderClass,
    );

    const response = await requestModels({} as any, mockAIGateway as any);

    await expect(response.json()).resolves.toEqual({
      object: "list",
      data: [],
    });
    expect(
      unavailableProviderClass.endpoints.models.validate,
    ).not.toHaveBeenCalled();
  });

  it("skips AI Gateway model discovery when local provider credentials are required", async () => {
    const unavailableProviderClass = {
      ...mockProviderClass,
      endpoints: {
        models: {
          ...mockProviderClass.endpoints.models,
          validate: vi.fn(),
          requiresProviderCredentials: true,
        },
      },
      available: vi.fn().mockReturnValue(false),
    };

    Object.keys(BUILT_IN_PROVIDER_CONSTRUCTORS).forEach((key) => {
      delete BUILT_IN_PROVIDER_CONSTRUCTORS[key];
    });
    BUILT_IN_PROVIDER_CONSTRUCTORS.unavailable = mockProviderConstructor(
      unavailableProviderClass,
    );

    const response = await requestModels({} as any, mockAIGateway as any);

    await expect(response.json()).resolves.toEqual({
      object: "list",
      data: [],
    });
    expect(
      unavailableProviderClass.endpoints.models.validate,
    ).not.toHaveBeenCalled();
    expect(mockAIGateway.buildProviderEndpointRequest).not.toHaveBeenCalled();
    expect(helpers.fetchWithLogging).not.toHaveBeenCalled();
  });

  it("should use AI Gateway when available and provider supported", async () => {
    mockAIGateway.buildProviderEndpointRequest.mockReturnValue([
      "https://gateway.ai.cloudflare.com/v1/account/gateway/openai/models",
      { method: "GET", headers: {} },
    ]);

    const request = new Request("https://example.com/g/gateway/models", {
      headers: {
        "cf-aig-collect-log": "false",
        "cf-connecting-ip": "203.0.113.1",
        "x-client": "retained-outside-gateway-controls",
      },
    });
    await requestModels({ request } as any, mockAIGateway as any);

    expect(CloudflareAIGateway.isSupportedProvider).toHaveBeenCalledWith(
      "openai",
    );
    expect(mockAIGateway.buildProviderEndpointRequest).toHaveBeenCalledWith({
      provider: "openai",
      method: "GET",
      path: "/models",
      headers: expect.any(Headers),
    });
    const headers = new Headers(
      mockAIGateway.buildProviderEndpointRequest.mock.calls[0][0].headers,
    );
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("cf-aig-collect-log")).toBe("false");
    expect(headers.has("x-client")).toBe(false);
    expect(headers.has("cf-connecting-ip")).toBe(false);
    expect(helpers.fetchWithLogging).toHaveBeenCalled();
  });

  it("uses a Custom Provider for unsupported model endpoints in strict mode", async () => {
    const provider = {
      ...mockProviderClass,
      endpoints: {
        models: {
          ...mockProviderClass.endpoints.models,
          supportsAiGateway: false,
        },
      },

      requiresCustomAiGatewayProvider: false,
      pathnamePrefix: vi.fn(() => "/v1"),
    };
    provider.available.mockReturnValue(true);
    provider.endpoints.models.validate.mockReturnValue([
      "/models",
      { method: "GET" },
    ]);
    const buildProviderEndpointRequest = vi
      .fn()
      .mockReturnValue([
        "https://gateway.example/custom-llm-proxy-ollama/v1/models",
        { method: "GET" },
      ]);
    vi.mocked(CloudflareAIGateway.isSupportedProvider).mockReturnValue(false);

    await requestModels(
      {
        providers: registryFor({ ollama: provider }),
      } as any,
      { alwaysUse: true, buildProviderEndpointRequest } as any,
    );

    expect(buildProviderEndpointRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "custom-llm-proxy-ollama",
        path: "/v1/models",
      }),
    );
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("should isolate AI Gateway request failures", async () => {
    mockAIGateway.buildProviderEndpointRequest.mockReturnValue([
      "https://gateway.ai.cloudflare.com/models",
      { method: "GET" },
    ]);
    vi.mocked(helpers.fetchWithLogging).mockRejectedValue(
      new Error("gateway failed"),
    );
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await requestModels({} as any, mockAIGateway as any);
    const body = (await response.json()) as ModelsResponse;

    expect(body.data).toEqual([]);
    expect(consoleSpy).toHaveBeenCalledWith({
      event: "provider.models.failed",
      request_id: null,
      provider: "openai",
      error_name: "Error",
      error_message: "gateway failed",
      message:
        "Provider model discovery failed: provider=openai, error_name=Error, error_message=gateway failed",
    });
  });

  it("does not parse or convert a non-successful upstream response", async () => {
    Object.keys(BUILT_IN_PROVIDER_CONSTRUCTORS).forEach((key) => {
      delete BUILT_IN_PROVIDER_CONSTRUCTORS[key];
    });
    BUILT_IN_PROVIDER_CONSTRUCTORS.openai =
      mockProviderConstructor(mockProviderClass);
    mockAIGateway.buildProviderEndpointRequest.mockReturnValue([
      "https://gateway.ai.cloudflare.com/models",
      { method: "GET" },
    ]);
    const upstreamResponse = new Response("Authentication failed", {
      status: 401,
    });
    const cancel = vi.spyOn(upstreamResponse.body!, "cancel");
    vi.mocked(helpers.fetchWithLogging).mockResolvedValue(upstreamResponse);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await requestModels({} as any, mockAIGateway as any);
    const body = (await response.json()) as ModelsResponse;

    expect(body.data).toEqual([]);
    expect(cancel).toHaveBeenCalledOnce();
    expect(helpers.readResponseJson).not.toHaveBeenCalled();
    expect(
      mockProviderClass.endpoints.models.convertResponse,
    ).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith({
      event: "provider.models.failed",
      request_id: null,
      provider: "openai",
      error_name: "Error",
      error_message: "Provider models request failed with HTTP 401.",
      message:
        "Provider model discovery failed: provider=openai, error_name=Error, error_message=Provider models request failed with HTTP 401.",
    });
  });

  it("handles a non-successful upstream response without a body", async () => {
    Object.keys(BUILT_IN_PROVIDER_CONSTRUCTORS).forEach((key) => {
      delete BUILT_IN_PROVIDER_CONSTRUCTORS[key];
    });
    BUILT_IN_PROVIDER_CONSTRUCTORS.openai =
      mockProviderConstructor(mockProviderClass);
    mockAIGateway.buildProviderEndpointRequest.mockReturnValue([
      "https://gateway.ai.cloudflare.com/models",
      { method: "GET" },
    ]);
    vi.mocked(helpers.fetchWithLogging).mockResolvedValue(
      new Response(null, { status: 401 }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await requestModels({} as any, mockAIGateway as any);

    expect(((await response.json()) as ModelsResponse).data).toEqual([]);
  });

  it("returns a valid partial list when Cohere is rate limited and OpenAI times out", async () => {
    const cohereResponse = new Response(
      JSON.stringify({ message: "rate limit exceeded" }),
      { status: 429 },
    );
    const cancelCohereBody = vi.spyOn(cohereResponse.body!, "cancel");
    const cohereProvider = {
      ...mockProviderClass,
      endpoints: {
        models: {
          ...mockProviderClass.endpoints.models,
          convertResponse: vi.fn(),
        },
      },
      send: vi.fn().mockResolvedValue(cohereResponse),
    };
    const openAIProvider = {
      ...mockProviderClass,
      endpoints: {
        models: {
          ...mockProviderClass.endpoints.models,
          convertResponse: vi.fn(),
        },
      },
      send: vi.fn().mockReturnValue(new Promise<Response>(() => {})),
    };
    const healthyProvider = {
      ...mockProviderClass,
      endpoints: {
        models: {
          ...mockProviderClass.endpoints.models,
          convertResponse: vi.fn().mockReturnValue({
            object: "list",
            data: [
              {
                id: "available-model",
                object: "model",
                created: 0,
                owned_by: "healthy",
              },
            ],
          }),
        },
      },
      send: vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ data: [] }))),
    };
    vi.mocked(helpers.withTimeout).mockImplementation(
      async (promise, abortController, _timeoutMs, providerName) => {
        if (providerName === "openai") {
          abortController.abort();
          const error = new Error("Provider openai request timed out");
          error.name = "TimeoutError";
          throw error;
        }
        return promise;
      },
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await requestModels({
      providers: registryFor({
        cohere: cohereProvider,
        openai: openAIProvider,
        healthy: healthyProvider,
      }),
    } as any);
    const responseText = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(() => JSON.parse(responseText)).not.toThrow();
    expect(JSON.parse(responseText)).toEqual({
      object: "list",
      data: [
        {
          id: "healthy/available-model",
          object: "model",
          created: 0,
          owned_by: "healthy",
        },
      ],
    });
    expect(cancelCohereBody).toHaveBeenCalledOnce();
    expect(
      cohereProvider.endpoints.models.convertResponse,
    ).not.toHaveBeenCalled();
    expect(
      openAIProvider.endpoints.models.convertResponse,
    ).not.toHaveBeenCalled();
  });

  it("should handle provider errors gracefully", async () => {
    const errorProviderClass = {
      ...mockProviderClass,
      send: vi.fn().mockRejectedValue(new Error("Network error")),
    };

    // Clear and reset providers
    Object.keys(BUILT_IN_PROVIDER_CONSTRUCTORS).forEach((key) => {
      delete BUILT_IN_PROVIDER_CONSTRUCTORS[key];
    });

    BUILT_IN_PROVIDER_CONSTRUCTORS.openai =
      mockProviderConstructor(mockProviderClass);
    BUILT_IN_PROVIDER_CONSTRUCTORS.error =
      mockProviderConstructor(errorProviderClass);

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await requestModels({} as any);
    const body = (await response.json()) as ModelsResponse;

    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("openai/gpt-4");
    expect(consoleSpy).toHaveBeenCalledWith({
      event: "provider.models.failed",
      request_id: null,
      provider: "error",
      error_name: "Error",
      error_message: "Network error",
      message:
        "Provider model discovery failed: provider=error, error_name=Error, error_message=Network error",
    });

    consoleSpy.mockRestore();
  });

  it("should handle ProviderNotSupportedError specially", async () => {
    const notSupportedProviderClass = {
      ...mockProviderClass,
      send: vi
        .fn()
        .mockRejectedValue(new ProviderNotSupportedError("Not supported")),
    };

    // Clear and reset providers
    Object.keys(BUILT_IN_PROVIDER_CONSTRUCTORS).forEach((key) => {
      delete BUILT_IN_PROVIDER_CONSTRUCTORS[key];
    });

    BUILT_IN_PROVIDER_CONSTRUCTORS.openai =
      mockProviderConstructor(mockProviderClass);
    BUILT_IN_PROVIDER_CONSTRUCTORS.notsupported = mockProviderConstructor(
      notSupportedProviderClass,
    );

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await requestModels({} as any);
    const body = (await response.json()) as ModelsResponse;

    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("openai/gpt-4");
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("should handle invalid response format", async () => {
    const invalidResponseProviderClass = {
      ...mockProviderClass,
      endpoints: {
        models: {
          ...mockProviderClass.endpoints.models,
          convertResponse: vi.fn().mockReturnValue(null),
        },
      },
      send: vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(new Response(JSON.stringify({ data: [] }))),
        ),
    };

    // Clear and reset providers
    Object.keys(BUILT_IN_PROVIDER_CONSTRUCTORS).forEach((key) => {
      delete BUILT_IN_PROVIDER_CONSTRUCTORS[key];
    });

    BUILT_IN_PROVIDER_CONSTRUCTORS.openai =
      mockProviderConstructor(mockProviderClass);
    BUILT_IN_PROVIDER_CONSTRUCTORS.invalid = mockProviderConstructor(
      invalidResponseProviderClass,
    );

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await requestModels({} as any);
    const body = (await response.json()) as ModelsResponse;

    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("openai/gpt-4");
    expect(consoleSpy).toHaveBeenCalledWith({
      event: "provider.models.invalid_response",
      request_id: null,
      provider: "invalid",
      message:
        "Provider model discovery returned an invalid response: provider=invalid",
    });

    consoleSpy.mockRestore();
  });

  it("should handle response without data field", async () => {
    const noDataProviderClass = {
      ...mockProviderClass,
      endpoints: {
        models: {
          ...mockProviderClass.endpoints.models,
          convertResponse: vi.fn().mockReturnValue({ object: "list" }),
        },
      },
      send: vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(new Response(JSON.stringify({ data: [] }))),
        ),
    };

    // Clear and reset providers
    Object.keys(BUILT_IN_PROVIDER_CONSTRUCTORS).forEach((key) => {
      delete BUILT_IN_PROVIDER_CONSTRUCTORS[key];
    });

    BUILT_IN_PROVIDER_CONSTRUCTORS.openai =
      mockProviderConstructor(mockProviderClass);
    BUILT_IN_PROVIDER_CONSTRUCTORS.nodata =
      mockProviderConstructor(noDataProviderClass);

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await requestModels({} as any);
    const body = (await response.json()) as ModelsResponse;

    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("openai/gpt-4");
    expect(consoleSpy).toHaveBeenCalledWith({
      event: "provider.models.invalid_response",
      request_id: null,
      provider: "nodata",
      message:
        "Provider model discovery returned an invalid response: provider=nodata",
    });

    consoleSpy.mockRestore();
  });

  it("should prefix model IDs with provider name", async () => {
    const multiModelProviderClass = {
      ...mockProviderClass,
      endpoints: {
        models: {
          ...mockProviderClass.endpoints.models,
          convertResponse: vi.fn().mockReturnValue({
            object: "list",
            data: [
              {
                id: "gpt-4",
                object: "model",
                created: 1234567890,
                owned_by: "openai",
              },
              {
                id: "gpt-3.5-turbo",
                object: "model",
                created: 1234567890,
                owned_by: "openai",
              },
            ],
          }),
        },
      },
    };

    // Clear and reset providers
    Object.keys(BUILT_IN_PROVIDER_CONSTRUCTORS).forEach((key) => {
      delete BUILT_IN_PROVIDER_CONSTRUCTORS[key];
    });

    BUILT_IN_PROVIDER_CONSTRUCTORS.openai = mockProviderConstructor(
      multiModelProviderClass,
    );

    const response = await requestModels({} as any);
    const body = (await response.json()) as ModelsResponse;

    expect(body.data).toHaveLength(2);
    expect(body.data[0].id).toBe("openai/gpt-4");
    expect(body.data[1].id).toBe("openai/gpt-3.5-turbo");
  });

  it("prefixes models with a named profile selector", async () => {
    const profiledProvider = {
      ...mockProviderClass,
      endpoints: {
        models: {
          ...mockProviderClass.endpoints.models,
          getStaticModels: vi.fn().mockReturnValue({
            object: "list",
            data: [
              {
                id: "gpt-oss-120b",
                object: "model",
                created: 0,
                owned_by: "ollama",
              },
            ],
          }),
        },
      },
      getCredentialProfiles: () => ["paid"],
      available(this: Provider) {
        return this.credentialProfile === "paid";
      },
    };

    const response = await requestModels({
      providers: registryFor({ ollama: profiledProvider }),
    } as any);
    const body = (await response.json()) as ModelsResponse;

    expect(body.data.map(({ id }) => id)).toEqual(["ollama:paid/gpt-oss-120b"]);
  });

  it("should return static models for custom providers when configured", async () => {
    const staticModelsProviderClass = {
      ...mockProviderClass,
      endpoints: {
        models: {
          ...mockProviderClass.endpoints.models,
          getStaticModels: vi.fn().mockReturnValue({
            object: "list",
            data: [
              {
                id: "custom-model-1",
                object: "model",
                created: 1234567890,
                owned_by: "custom",
              },
            ],
          }),
        },
      },
    };

    // Clear and reset providers
    Object.keys(BUILT_IN_PROVIDER_CONSTRUCTORS).forEach((key) => {
      delete BUILT_IN_PROVIDER_CONSTRUCTORS[key];
    });

    BUILT_IN_PROVIDER_CONSTRUCTORS.custom = mockProviderConstructor(
      staticModelsProviderClass,
    );

    const response = await requestModels({} as any);
    const body = (await response.json()) as ModelsResponse;

    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("custom/custom-model-1");
    expect(mockProviderClass.send).not.toHaveBeenCalled();
    expect(
      staticModelsProviderClass.endpoints.models.getStaticModels,
    ).toHaveBeenCalled();
  });

  it("authenticates the model request with the selected key before sending", async () => {
    const testProviderClass = {
      ...mockProviderClass,
      endpoints: {
        models: {
          ...mockProviderClass.endpoints.models,
          convertResponse: vi.fn().mockReturnValue({
            object: "list",
            data: [
              {
                id: "test-model",
                object: "model",
                created: 1234567890,
                owned_by: "test",
              },
            ],
          }),
        },
      },
      headers: vi.fn(async (index?: number) => ({
        Authorization: `Bearer key-${index}`,
      })),
      send: vi.fn().mockResolvedValue(Response.json({ data: [] })),
    };

    // Clear and reset providers
    Object.keys(BUILT_IN_PROVIDER_CONSTRUCTORS).forEach((key) => {
      delete BUILT_IN_PROVIDER_CONSTRUCTORS[key];
    });

    BUILT_IN_PROVIDER_CONSTRUCTORS.test =
      mockProviderConstructor(testProviderClass);
    testProviderClass.getApiKeys.mockReturnValue(["key1", "key2", "key3"]);

    // Mock CloudflareAIGateway.isSupportedProvider to return false
    vi.mocked(CloudflareAIGateway.isSupportedProvider).mockReturnValue(false);

    const response = await requestModels({ apiKeyIndex: 2 } as any);
    const body = (await response.json()) as ModelsResponse;

    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("test/test-model");
    expect(testProviderClass.headers).toHaveBeenCalledExactlyOnceWith(2);
    expect(
      new Headers(testProviderClass.send.mock.calls[0][1].headers).get(
        "authorization",
      ),
    ).toBe("Bearer key-2");
  });

  describe("rate-limit key rotation", () => {
    const successfulModels = {
      object: "list",
      data: [
        {
          id: "retry-model",
          object: "model",
          created: 0,
          owned_by: "test",
        },
      ],
    };

    function createKeyedProvider(
      fetch: ReturnType<typeof vi.fn>,
      keys: string[],
    ) {
      return {
        ...mockProviderClass,
        getApiKeys: vi.fn().mockReturnValue(keys),
        fetch,
        convertModelsToOpenAIFormat: vi.fn().mockReturnValue(successfulModels),
      };
    }

    it("retries sequential later keys after HTTP 429 and returns the first success", async () => {
      const rateLimited = new Response("rate limited", { status: 429 });
      const cancel = vi.spyOn(rateLimited.body!, "cancel");
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(rateLimited)
        .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] })));
      const provider = createKeyedProvider(fetch, ["key-a", "key-b", "key-c"]);
      const consoleWarn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      const response = await handleModelsRequest({
        providers: { all: () => ({ test: provider }) },
      } as any);
      const body = (await response.json()) as ModelsResponse;

      expect(body.data.map((model) => model.id)).toEqual(["test/retry-model"]);
      expect(cancel).toHaveBeenCalledOnce();
      expect(fetch).toHaveBeenNthCalledWith(
        1,
        "/models",
        expect.objectContaining({ method: "GET" }),
        0,
      );
      expect(fetch).toHaveBeenNthCalledWith(
        2,
        "/models",
        expect.objectContaining({ method: "GET" }),
        1,
      );
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(consoleWarn).toHaveBeenCalledWith({
        event: "provider.models.key_retry",
        request_id: null,
        provider: "test",
        key_index: 0,
        next_key_index: 1,
        status: 429,
        attempt: 1,
        message:
          "Retrying provider model discovery with the next credential after HTTP 429: provider=test, key_index=0, next_key_index=1, status=429, attempt=1",
      });
    });

    it("continues after a 429 even when discarding the failed body throws", async () => {
      const rateLimited = new Response("rate limited", { status: 429 });
      vi.spyOn(rateLimited.body!, "cancel").mockRejectedValue(
        new Error("already locked"),
      );
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(rateLimited)
        .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] })));
      const provider = createKeyedProvider(fetch, ["key-a", "key-b"]);
      vi.spyOn(console, "warn").mockImplementation(() => {});

      const response = await handleModelsRequest({
        providers: { all: () => ({ test: provider }) },
      } as any);

      expect(((await response.json()) as ModelsResponse).data).toEqual([
        {
          id: "test/retry-model",
          object: "model",
          created: 0,
          owned_by: "test",
        },
      ]);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("stops after the bounded number of 429 attempts", async () => {
      const keys = ["key-a", "key-b", "key-c", "key-d"];
      const fetch = vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(new Response("rate limited", { status: 429 })),
        );
      const provider = createKeyedProvider(fetch, keys);
      provider.convertModelsToOpenAIFormat = vi.fn();
      const consoleWarn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const response = await handleModelsRequest({
        providers: { all: () => ({ test: provider }) },
      } as any);

      expect(((await response.json()) as ModelsResponse).data).toEqual([]);
      expect(fetch.mock.calls.map(([, , apiKeyIndex]) => apiKeyIndex)).toEqual([
        0, 1, 2,
      ]);
      expect(fetch).toHaveBeenCalledTimes(MAX_MODELS_RATE_LIMIT_KEY_ATTEMPTS);
      expect(
        consoleWarn.mock.calls.filter(
          ([record]) => record.event === "provider.models.key_retry",
        ),
      ).toHaveLength(MAX_MODELS_RATE_LIMIT_KEY_ATTEMPTS - 1);
      expect(consoleError).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "provider.models.failed",
          error_message: "Provider models request failed with HTTP 429.",
        }),
      );
      expect(provider.convertModelsToOpenAIFormat).not.toHaveBeenCalled();
    });

    it("does not rotate after a non-429 failure", async () => {
      const fetch = vi
        .fn()
        .mockResolvedValue(new Response("unauthorized", { status: 401 }));
      const provider = createKeyedProvider(fetch, ["key-a", "key-b", "key-c"]);
      provider.convertModelsToOpenAIFormat = vi.fn();
      vi.spyOn(console, "error").mockImplementation(() => {});

      const response = await handleModelsRequest({
        providers: { all: () => ({ test: provider }) },
      } as any);

      expect(((await response.json()) as ModelsResponse).data).toEqual([]);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith(
        "/models",
        expect.objectContaining({ method: "GET" }),
        0,
      );
    });

    it("does not rotate when an explicit key selection is present", async () => {
      const fetch = vi
        .fn()
        .mockResolvedValue(new Response("rate limited", { status: 429 }));
      const provider = createKeyedProvider(fetch, ["key-a", "key-b", "key-c"]);
      vi.spyOn(console, "error").mockImplementation(() => {});

      const response = await handleModelsRequest({
        apiKeyIndex: 1,
        providers: { all: () => ({ test: provider }) },
      } as any);

      expect(((await response.json()) as ModelsResponse).data).toEqual([]);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith(
        "/models",
        expect.objectContaining({ method: "GET" }),
        1,
      );
    });

    it("does not rotate when an explicit key range is present", async () => {
      const fetch = vi
        .fn()
        .mockResolvedValue(new Response("rate limited", { status: 429 }));
      const provider = createKeyedProvider(fetch, ["key-a", "key-b", "key-c"]);
      vi.spyOn(console, "error").mockImplementation(() => {});

      const response = await handleModelsRequest({
        apiKeyIndex: { start: 0, end: 2 },
        providers: { all: () => ({ test: provider }) },
      } as any);

      expect(((await response.json()) as ModelsResponse).data).toEqual([]);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("does not continue after a later non-429 failure", async () => {
      const rateLimited = new Response("rate limited", { status: 429 });
      const serverError = new Response("upstream error", { status: 500 });
      const cancelRateLimited = vi.spyOn(rateLimited.body!, "cancel");
      const cancelServerError = vi.spyOn(serverError.body!, "cancel");
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(rateLimited)
        .mockResolvedValueOnce(serverError);
      const provider = createKeyedProvider(fetch, ["key-a", "key-b", "key-c"]);
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});

      const response = await handleModelsRequest({
        providers: { all: () => ({ test: provider }) },
      } as any);

      expect(((await response.json()) as ModelsResponse).data).toEqual([]);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(cancelRateLimited).toHaveBeenCalledOnce();
      expect(cancelServerError).toHaveBeenCalledOnce();
    });

    it("includes a named credential profile on the retry log", async () => {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] })));
      const provider = createKeyedProvider(fetch, ["key-a", "key-b"]);
      const consoleWarn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      await handleModelsRequest({
        providers: { all: () => ({ "openai:paid": provider }) },
      } as any);

      expect(consoleWarn).toHaveBeenCalledWith({
        event: "provider.models.key_retry",
        request_id: null,
        provider: "openai",
        credential_profile: "paid",
        key_index: 0,
        next_key_index: 1,
        status: 429,
        attempt: 1,
        message:
          "Retrying provider model discovery with the next credential after HTTP 429: provider=openai, credential_profile=paid, key_index=0, next_key_index=1, status=429, attempt=1",
      });
    });

    it("retries the next credential through AI Gateway after HTTP 429", async () => {
      mockAIGateway.buildProviderEndpointRequest.mockReturnValue([
        "https://gateway.ai.cloudflare.com/v1/account/gateway/openai/models",
        { method: "GET", headers: {} },
      ]);
      const rateLimited = new Response("rate limited", { status: 429 });
      const cancel = vi.spyOn(rateLimited.body!, "cancel");
      vi.mocked(helpers.fetchWithLogging)
        .mockResolvedValueOnce(rateLimited)
        .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] })));
      const provider = createKeyedProvider(vi.fn(), ["key-a", "key-b"]);
      provider.headers = vi.fn().mockImplementation((apiKeyIndex?: number) => ({
        Authorization: `Bearer key-${apiKeyIndex ?? 0}`,
      }));
      vi.spyOn(console, "warn").mockImplementation(() => {});

      const response = await handleModelsRequest(
        { providers: { all: () => ({ openai: provider }) } } as any,
        mockAIGateway as any,
      );

      expect(((await response.json()) as ModelsResponse).data).toEqual([
        {
          id: "openai/retry-model",
          object: "model",
          created: 0,
          owned_by: "test",
        },
      ]);
      expect(cancel).toHaveBeenCalledOnce();
      expect(provider.fetch).not.toHaveBeenCalled();
      expect(helpers.fetchWithLogging).toHaveBeenCalledTimes(2);
      expect(provider.headers).toHaveBeenNthCalledWith(1, 0);
      expect(provider.headers).toHaveBeenNthCalledWith(2, 1);
      const firstGatewayHeaders = new Headers(
        mockAIGateway.buildProviderEndpointRequest.mock.calls[0][0].headers,
      );
      const secondGatewayHeaders = new Headers(
        mockAIGateway.buildProviderEndpointRequest.mock.calls[1][0].headers,
      );
      expect(firstGatewayHeaders.get("Authorization")).toBe("Bearer key-0");
      expect(secondGatewayHeaders.get("Authorization")).toBe("Bearer key-1");
    });
  });

  it("bounds both per-provider model count and aggregate output size", async () => {
    Object.keys(BUILT_IN_PROVIDER_CONSTRUCTORS).forEach((key) => {
      delete BUILT_IN_PROVIDER_CONSTRUCTORS[key];
    });
    const boundedProvider = {
      ...mockProviderClass,
      endpoints: {
        models: {
          ...mockProviderClass.endpoints.models,
          convertResponse: vi.fn().mockReturnValue({
            object: "list",
            data: Array.from(
              { length: MAX_MODELS_PER_PROVIDER + 1 },
              (_, index) => ({
                id: `model-${index}`,
                object: "model",
                created: 0,
                owned_by: "test",
              }),
            ),
          }),
        },
      },
    };
    BUILT_IN_PROVIDER_CONSTRUCTORS.test =
      mockProviderConstructor(boundedProvider);

    const response = await requestModels({} as any);
    const body = (await response.json()) as ModelsResponse;
    expect(body.data).toHaveLength(MAX_MODELS_PER_PROVIDER);

    boundedProvider.endpoints.models.convertResponse.mockReturnValue({
      object: "list",
      data: [
        {
          id: "oversized",
          object: "model",
          created: 0,
          owned_by: "test",
          _: "x".repeat(MAX_AGGREGATED_MODELS_BYTES + 1),
        },
      ],
    });
    const truncatedResponse = await requestModels({} as any);
    expect(truncatedResponse.headers.get("X-Proxy-Models-Truncated")).toBe(
      "true",
    );
    await expect(truncatedResponse.json()).resolves.toEqual({
      object: "list",
      data: [],
    });
  });

  describe("models cache", () => {
    // Each test uses a distinct key selection or gateway id so cache entries
    // can never leak between tests.
    beforeEach(() => {
      Environments.setEnv({
        MODELS_CACHE_TTL_SECONDS: "60",
      } as unknown as Env);
    });

    it("falls back to uncached discovery when opening Cache API fails", async () => {
      vi.spyOn(caches, "open").mockRejectedValue(
        new Error("Cache API unavailable"),
      );

      const response = await requestModels({
        apiKeyIndex: 41,
      } as any);

      expect(response.status).toBe(200);
      expect(response.headers.get("X-Proxy-Models-Cache")).toBeNull();
      expect(mockProviderClass.send).toHaveBeenCalled();
    });

    it("falls back to uncached discovery when reading Cache API fails", async () => {
      const cache = {
        match: vi.fn().mockRejectedValue(new Error("Cache read unavailable")),
        put: vi.fn(),
      } as unknown as Cache;
      vi.spyOn(caches, "open").mockResolvedValue(cache);

      const response = await requestModels({
        apiKeyIndex: 42,
      } as any);

      expect(response.status).toBe(200);
      expect(response.headers.get("X-Proxy-Models-Cache")).toBeNull();
      expect(cache.put).not.toHaveBeenCalled();
      expect(mockProviderClass.send).toHaveBeenCalled();
    });

    it("serves a cache miss when an asynchronous cache write fails", async () => {
      const cache = {
        match: vi.fn().mockResolvedValue(undefined),
        put: vi.fn().mockRejectedValue(new Error("Cache write unavailable")),
      } as unknown as Cache;
      vi.spyOn(caches, "open").mockResolvedValue(cache);
      const ctx = createExecutionContext();
      const waitUntil = vi.spyOn(ctx, "waitUntil");

      const response = await requestModels({
        apiKeyIndex: 43,
        ctx,
      } as any);

      expect(response.status).toBe(200);
      expect(response.headers.get("X-Proxy-Models-Cache")).toBe("MISS");
      expect(waitUntil).toHaveBeenCalledOnce();
      await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
    });

    it("stores successful aggregates and serves subsequent requests from the cache", async () => {
      const ctx = createExecutionContext();
      const waitUntil = vi.spyOn(ctx, "waitUntil");
      const context = { ctx, apiKeyIndex: 11 } as any;

      const missResponse = await requestModels(context);
      expect(missResponse.headers.get("X-Proxy-Models-Cache")).toBe("MISS");
      expect(waitUntil).toHaveBeenCalledOnce();
      await waitUntil.mock.calls[0][0];
      const upstreamCalls = mockProviderClass.send.mock.calls.length;

      const hitResponse = await requestModels(context);
      expect(hitResponse.headers.get("X-Proxy-Models-Cache")).toBe("HIT");
      expect(hitResponse.headers.get("Cache-Control")).toBe(
        "private, no-store",
      );
      expect(hitResponse.headers.get("Content-Type")).toBe("application/json");
      expect(mockProviderClass.send.mock.calls.length).toBe(upstreamCalls);
      await expect(hitResponse.json()).resolves.toEqual(
        await missResponse.json(),
      );
    });

    it("awaits the cache write when no execution context is available", async () => {
      const context = { apiKeyIndex: 12 } as any;

      const missResponse = await requestModels(context);
      expect(missResponse.headers.get("X-Proxy-Models-Cache")).toBe("MISS");

      const hitResponse = await requestModels(context);
      expect(hitResponse.headers.get("X-Proxy-Models-Cache")).toBe("HIT");
    });

    it("retrieves one model from a cached aggregate", async () => {
      // A cache hit carries no per-model fragments, so retrieval falls back to
      // reading the stored aggregate body.
      const context = { apiKeyIndex: 21 } as any;
      await requestModels(context);

      const found = await requestModel(context, "openai/gpt-4");
      expect(found.headers.get("X-Proxy-Models-Cache")).toBe("HIT");
      await expect(found.json()).resolves.toMatchObject({
        id: "openai/gpt-4",
      });

      const missing = await requestModel(context, "openai/absent");
      expect(missing.status).toBe(404);
      await expect(missing.json()).resolves.toEqual({
        error: expect.objectContaining({ code: "model_not_found" }),
      });
    });

    it("bypasses the cache when the client sends Cache-Control: no-store", async () => {
      const bypassResponse = await requestModels({
        apiKeyIndex: 13,
        request: new Request("https://example.com/models", {
          headers: { "Cache-Control": "no-store" },
        }),
      } as any);
      expect(bypassResponse.headers.get("X-Proxy-Models-Cache")).toBeNull();

      // Nothing was stored, so a cache-enabled request still misses.
      const missResponse = await requestModels({
        apiKeyIndex: 13,
      } as any);
      expect(missResponse.headers.get("X-Proxy-Models-Cache")).toBe("MISS");
    });

    it("refreshes the cache when the client sends Cache-Control: no-cache", async () => {
      const primeResponse = await requestModels({
        apiKeyIndex: 14,
      } as any);
      expect(primeResponse.headers.get("X-Proxy-Models-Cache")).toBe("MISS");

      mockProviderClass.endpoints.models.convertResponse.mockReturnValue({
        object: "list",
        data: [
          { id: "fresh-model", object: "model", created: 1, owned_by: "test" },
        ],
      });
      const refreshResponse = await requestModels({
        apiKeyIndex: 14,
        request: new Request("https://example.com/models", {
          headers: { "Cache-Control": "no-cache" },
        }),
      } as any);
      expect(refreshResponse.headers.get("X-Proxy-Models-Cache")).toBe("MISS");

      const hitResponse = await requestModels({ apiKeyIndex: 14 } as any);
      expect(hitResponse.headers.get("X-Proxy-Models-Cache")).toBe("HIT");
      const body = (await hitResponse.json()) as ModelsResponse;
      expect(body.data.map((model) => model.id)).toEqual([
        "openai/fresh-model",
        "anthropic/fresh-model",
      ]);
    });

    it("scopes cache entries by gateway identity", async () => {
      const buildProviderEndpointRequest = vi
        .fn()
        .mockReturnValue([
          "https://gateway.ai.cloudflare.com/v1/acc/gw/openai/models",
          { method: "GET", headers: {} },
        ]);
      const gateway = (gatewayId: string, alwaysUse: boolean) =>
        ({
          accountId: "acc",
          gatewayId,
          alwaysUse,
          buildProviderEndpointRequest,
        }) as any;

      const missResponse = await requestModels(
        { request: new Request("https://example.com/g/gw-a/models") } as any,
        gateway("gw-a", false),
      );
      expect(missResponse.headers.get("X-Proxy-Models-Cache")).toBe("MISS");

      const hitResponse = await requestModels(
        {} as any,
        gateway("gw-a", false),
      );
      expect(hitResponse.headers.get("X-Proxy-Models-Cache")).toBe("HIT");

      const otherGatewayResponse = await requestModels(
        {} as any,
        gateway("gw-b", false),
      );
      expect(otherGatewayResponse.headers.get("X-Proxy-Models-Cache")).toBe(
        "MISS",
      );

      const alwaysUseResponse = await requestModels(
        {} as any,
        gateway("gw-a", true),
      );
      expect(alwaysUseResponse.headers.get("X-Proxy-Models-Cache")).toBe(
        "MISS",
      );
    });

    it("scopes cache entries by key selection", async () => {
      const missResponse = await requestModels({
        apiKeyIndex: { start: 1 },
      } as any);
      expect(missResponse.headers.get("X-Proxy-Models-Cache")).toBe("MISS");

      const hitResponse = await requestModels({
        apiKeyIndex: { start: 1 },
      } as any);
      expect(hitResponse.headers.get("X-Proxy-Models-Cache")).toBe("HIT");

      const rangeResponse = await requestModels({
        apiKeyIndex: { start: 1, end: 2 },
      } as any);
      expect(rangeResponse.headers.get("X-Proxy-Models-Cache")).toBe("MISS");

      const endOnlyResponse = await requestModels({
        apiKeyIndex: { end: 2 },
      } as any);
      expect(endOnlyResponse.headers.get("X-Proxy-Models-Cache")).toBe("MISS");
    });

    it("bypasses the cache when client Gateway tuning headers are present", async () => {
      const buildProviderEndpointRequest = vi
        .fn()
        .mockReturnValue([
          "https://gateway.ai.cloudflare.com/v1/acc/gw/openai/models",
          { method: "GET", headers: {} },
        ]);
      const aiGateway = {
        accountId: "acc",
        gatewayId: "gw-tuning",
        alwaysUse: false,
        buildProviderEndpointRequest,
      } as any;

      const bypassResponse = await requestModels(
        {
          request: new Request("https://example.com/g/gw-tuning/models", {
            headers: { "cf-aig-metadata": '{"caller":"test"}' },
          }),
        } as any,
        aiGateway,
      );
      expect(bypassResponse.headers.get("X-Proxy-Models-Cache")).toBeNull();

      const missResponse = await requestModels({} as any, aiGateway);
      expect(missResponse.headers.get("X-Proxy-Models-Cache")).toBe("MISS");
    });

    it("partitions cached aggregates by provider filter", async () => {
      const filtered = await requestModels({
        request: new Request("https://example.com/v1/models?provider=openai"),
        apiKeyIndex: 51,
      } as any);
      expect(filtered.headers.get("X-Proxy-Models-Cache")).toBe("MISS");
    });

    it("does not cache aggregates with a failed provider", async () => {
      const errorProviderClass = {
        ...mockProviderClass,
        send: vi.fn().mockRejectedValue(new Error("Network error")),
      };
      Object.keys(BUILT_IN_PROVIDER_CONSTRUCTORS).forEach((key) => {
        delete BUILT_IN_PROVIDER_CONSTRUCTORS[key];
      });
      BUILT_IN_PROVIDER_CONSTRUCTORS.openai =
        mockProviderConstructor(mockProviderClass);
      BUILT_IN_PROVIDER_CONSTRUCTORS.error =
        mockProviderConstructor(errorProviderClass);
      vi.spyOn(console, "error").mockImplementation(() => {});

      const missResponse = await requestModels({
        apiKeyIndex: 31,
      } as any);
      expect(missResponse.headers.get("X-Proxy-Models-Cache")).toBe("MISS");

      const uncachedResponse = await requestModels({
        apiKeyIndex: 31,
      } as any);
      expect(uncachedResponse.headers.get("X-Proxy-Models-Cache")).toBe("MISS");
    });

    it("does not cache truncated aggregates", async () => {
      Object.keys(BUILT_IN_PROVIDER_CONSTRUCTORS).forEach((key) => {
        delete BUILT_IN_PROVIDER_CONSTRUCTORS[key];
      });
      const oversizedProvider = {
        ...mockProviderClass,
        endpoints: {
          models: {
            ...mockProviderClass.endpoints.models,
            convertResponse: vi.fn().mockReturnValue({
              object: "list",
              data: [
                {
                  id: "oversized",
                  object: "model",
                  created: 0,
                  owned_by: "test",
                  _: "x".repeat(MAX_AGGREGATED_MODELS_BYTES + 1),
                },
              ],
            }),
          },
        },
      };
      BUILT_IN_PROVIDER_CONSTRUCTORS.test =
        mockProviderConstructor(oversizedProvider);
      vi.spyOn(console, "warn").mockImplementation(() => {});

      const truncatedResponse = await requestModels({
        apiKeyIndex: 32,
      } as any);
      expect(truncatedResponse.headers.get("X-Proxy-Models-Truncated")).toBe(
        "true",
      );
      expect(truncatedResponse.headers.get("X-Proxy-Models-Cache")).toBe(
        "MISS",
      );

      const uncachedResponse = await requestModels({
        apiKeyIndex: 32,
      } as any);
      expect(uncachedResponse.headers.get("X-Proxy-Models-Cache")).toBe("MISS");
    });
  });
});
