import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CloudflareAIGateway } from "~/src/ai_gateway";
import { BUILT_IN_PROVIDER_CONSTRUCTORS } from "~/src/providers";
import { getAllProviderInstances, getProviderByName } from "~/src/providers";
import { ProviderNotSupportedError } from "~/src/providers/provider";
import {
  handleModelsRequest,
  MAX_AGGREGATED_MODELS_BYTES,
  MAX_MODELS_PER_PROVIDER,
} from "~/src/requests/models";
import { Environments } from "~/src/utils/environments";
import * as helpers from "~/src/utils/helpers";
import { Secrets } from "~/src/utils/secrets";

vi.mock("~/src/ai_gateway");
vi.mock("~/src/providers", async () => {
  const actual =
    await vi.importActual<typeof import("~/src/providers")>("~/src/providers");
  return {
    ...actual,
    getProviderByName: vi.fn(),
    getAllProviderInstances: vi.fn(),
  };
});
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
  });
}

describe("models", () => {
  const mockProviderClass = {
    available: vi.fn(),
    baseUrl: vi.fn(() => "https://api.example.com"),
    buildModelsRequest: vi.fn(),
    convertModelsToOpenAIFormat: vi.fn(),
    fetch: vi.fn(),
    headers: vi.fn(),
    getStaticModels: vi.fn(),
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
    vi.mocked(Secrets.getNext).mockResolvedValue(0);
    vi.mocked(Secrets.resolveApiKeyIndex).mockImplementation((selection) => {
      if (typeof selection === "number") {
        return selection;
      }
      return 0;
    });

    vi.mocked(getAllProviderInstances).mockImplementation(() => {
      return Object.fromEntries(
        Object.entries(BUILT_IN_PROVIDER_CONSTRUCTORS).map(
          ([name, ProviderClass]) => [name, new (ProviderClass as any)()],
        ),
      );
    });

    vi.mocked(getProviderByName).mockImplementation((name) => {
      const ProviderClass = BUILT_IN_PROVIDER_CONSTRUCTORS[name];
      return ProviderClass ? new (ProviderClass as any)() : undefined;
    });

    // Set up default mock providers in a specific order
    BUILT_IN_PROVIDER_CONSTRUCTORS.openai =
      mockProviderConstructor(mockProviderClass);
    BUILT_IN_PROVIDER_CONSTRUCTORS.anthropic =
      mockProviderConstructor(mockProviderClass);

    mockProviderClass.available.mockReturnValue(true);
    mockProviderClass.buildModelsRequest.mockReturnValue([
      "/models",
      { method: "GET" },
    ]);
    mockProviderClass.convertModelsToOpenAIFormat.mockReturnValue({
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
    mockProviderClass.fetch.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ data: [] }))),
    );
  });

  afterEach(() => {
    Environments.setEnv(undefined);
  });

  it("should return models from all available providers", async () => {
    const response = await handleModelsRequest({} as any);

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

  it("lists configured virtual models at the front of the response", async () => {
    Environments.setEnv({
      MODELS_CACHE_TTL_SECONDS: "0",
      VIRTUAL_MODELS: JSON.stringify({
        "virtual/fast-tier": ["openai/gpt-4"],
        "group/blend": ["anthropic/claude"],
      }),
    } as unknown as Env);

    const response = await handleModelsRequest({} as any);
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
    const response = await handleModelsRequest({} as any);
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
      fetch: vi.fn().mockResolvedValue(upstreamResponse),
      convertModelsToOpenAIFormat: vi.fn().mockReturnValue(formattedModels),
    };

    BUILT_IN_PROVIDER_CONSTRUCTORS.test =
      mockProviderConstructor(parsingProviderClass);
    vi.mocked(CloudflareAIGateway.isSupportedProvider).mockReturnValue(false);

    const response = await handleModelsRequest({} as any);
    const [timeoutPromise, abortController, timeoutMs, providerName] =
      vi.mocked(helpers.withTimeout).mock.calls[0];

    await expect(timeoutPromise).resolves.toBe(formattedModels);
    expect(abortController).toBeInstanceOf(AbortController);
    expect(timeoutMs).toBe(30_000);
    expect(providerName).toBe("test");
    expect(json).toHaveBeenCalledOnce();
    expect(
      parsingProviderClass.convertModelsToOpenAIFormat,
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
      fetch: vi.fn(
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

    const responsePromise = handleModelsRequest({
      providers: { all: vi.fn(() => providers) },
    } as any);

    await vi.waitFor(() => {
      expect(concurrentProvider.fetch).toHaveBeenCalledTimes(6);
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

    const response = await handleModelsRequest({} as any);
    const body = (await response.json()) as ModelsResponse;

    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("openai/gpt-4");
  });

  it("should skip unavailable providers that cannot list models through AI Gateway", async () => {
    const unavailableProviderClass = {
      ...mockProviderClass,
      available: vi.fn().mockReturnValue(false),
      supportsAiGatewayModels: false,
      buildModelsRequest: vi.fn(),
    };

    Object.keys(BUILT_IN_PROVIDER_CONSTRUCTORS).forEach((key) => {
      delete BUILT_IN_PROVIDER_CONSTRUCTORS[key];
    });
    BUILT_IN_PROVIDER_CONSTRUCTORS.unavailable = mockProviderConstructor(
      unavailableProviderClass,
    );

    const response = await handleModelsRequest({} as any, mockAIGateway as any);

    await expect(response.json()).resolves.toEqual({
      object: "list",
      data: [],
    });
    expect(unavailableProviderClass.buildModelsRequest).not.toHaveBeenCalled();
  });

  it("skips AI Gateway model discovery when local provider credentials are required", async () => {
    const unavailableProviderClass = {
      ...mockProviderClass,
      available: vi.fn().mockReturnValue(false),
      requiresProviderCredentialsForModels: true,
      buildModelsRequest: vi.fn(),
    };

    Object.keys(BUILT_IN_PROVIDER_CONSTRUCTORS).forEach((key) => {
      delete BUILT_IN_PROVIDER_CONSTRUCTORS[key];
    });
    BUILT_IN_PROVIDER_CONSTRUCTORS.unavailable = mockProviderConstructor(
      unavailableProviderClass,
    );

    const response = await handleModelsRequest({} as any, mockAIGateway as any);

    await expect(response.json()).resolves.toEqual({
      object: "list",
      data: [],
    });
    expect(unavailableProviderClass.buildModelsRequest).not.toHaveBeenCalled();
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
      },
    });
    await handleModelsRequest({ request } as any, mockAIGateway as any);

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
    expect(headers.has("cf-connecting-ip")).toBe(false);
    expect(helpers.fetchWithLogging).toHaveBeenCalled();
  });

  it("uses a Custom Provider for unsupported model endpoints in strict mode", async () => {
    const provider = {
      ...mockProviderClass,
      supportsAiGatewayModels: false,
      requiresCustomAiGatewayProvider: false,
      pathnamePrefix: vi.fn(() => "/v1"),
    };
    provider.available.mockReturnValue(true);
    provider.buildModelsRequest.mockReturnValue(["/models", { method: "GET" }]);
    const buildProviderEndpointRequest = vi
      .fn()
      .mockReturnValue([
        "https://gateway.example/custom-llm-proxy-ollama/v1/models",
        { method: "GET" },
      ]);
    vi.mocked(CloudflareAIGateway.isSupportedProvider).mockReturnValue(false);

    await handleModelsRequest(
      {
        providers: { all: vi.fn(() => ({ ollama: provider })) },
      } as any,
      { alwaysUse: true, buildProviderEndpointRequest } as any,
    );

    expect(buildProviderEndpointRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "custom-llm-proxy-ollama",
        path: "/v1/models",
      }),
    );
    expect(provider.fetch).not.toHaveBeenCalled();
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

    const response = await handleModelsRequest({} as any, mockAIGateway as any);
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

    const response = await handleModelsRequest({} as any, mockAIGateway as any);
    const body = (await response.json()) as ModelsResponse;

    expect(body.data).toEqual([]);
    expect(cancel).toHaveBeenCalledOnce();
    expect(helpers.readResponseJson).not.toHaveBeenCalled();
    expect(
      mockProviderClass.convertModelsToOpenAIFormat,
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

    const response = await handleModelsRequest({} as any, mockAIGateway as any);

    expect((await response.json()).data).toEqual([]);
  });

  it("should handle provider errors gracefully", async () => {
    const errorProviderClass = {
      ...mockProviderClass,
      fetch: vi.fn().mockRejectedValue(new Error("Network error")),
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

    const response = await handleModelsRequest({} as any);
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
      fetch: vi
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

    const response = await handleModelsRequest({} as any);
    const body = (await response.json()) as ModelsResponse;

    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("openai/gpt-4");
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("should handle invalid response format", async () => {
    const invalidResponseProviderClass = {
      ...mockProviderClass,
      fetch: vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(new Response(JSON.stringify({ data: [] }))),
        ),
      convertModelsToOpenAIFormat: vi.fn().mockReturnValue(null),
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

    const response = await handleModelsRequest({} as any);
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
      fetch: vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(new Response(JSON.stringify({ data: [] }))),
        ),
      convertModelsToOpenAIFormat: vi.fn().mockReturnValue({ object: "list" }),
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

    const response = await handleModelsRequest({} as any);
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
      convertModelsToOpenAIFormat: vi.fn().mockReturnValue({
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
    };

    // Clear and reset providers
    Object.keys(BUILT_IN_PROVIDER_CONSTRUCTORS).forEach((key) => {
      delete BUILT_IN_PROVIDER_CONSTRUCTORS[key];
    });

    BUILT_IN_PROVIDER_CONSTRUCTORS.openai = mockProviderConstructor(
      multiModelProviderClass,
    );

    const response = await handleModelsRequest({} as any);
    const body = (await response.json()) as ModelsResponse;

    expect(body.data).toHaveLength(2);
    expect(body.data[0].id).toBe("openai/gpt-4");
    expect(body.data[1].id).toBe("openai/gpt-3.5-turbo");
  });

  it("prefixes models with a named profile selector", async () => {
    const profiledProvider = {
      ...mockProviderClass,
      available: vi.fn().mockReturnValue(true),
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
    };

    const response = await handleModelsRequest({
      providers: { all: () => ({ "ollama:paid": profiledProvider }) },
    } as any);
    const body = (await response.json()) as ModelsResponse;

    expect(body.data.map(({ id }) => id)).toEqual(["ollama:paid/gpt-oss-120b"]);
  });

  it("should return static models for custom providers when configured", async () => {
    const staticModelsProviderClass = {
      ...mockProviderClass,
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
    };

    // Clear and reset providers
    Object.keys(BUILT_IN_PROVIDER_CONSTRUCTORS).forEach((key) => {
      delete BUILT_IN_PROVIDER_CONSTRUCTORS[key];
    });

    BUILT_IN_PROVIDER_CONSTRUCTORS.custom = mockProviderConstructor(
      staticModelsProviderClass,
    );

    const response = await handleModelsRequest({} as any);
    const body = (await response.json()) as ModelsResponse;

    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("custom/custom-model-1");
    expect(mockProviderClass.fetch).not.toHaveBeenCalled();
    expect(staticModelsProviderClass.getStaticModels).toHaveBeenCalled();
  });

  it("should pass apiKeyIndex to provider.fetch call", async () => {
    const testProviderClass = {
      ...mockProviderClass,
      fetch: vi
        .fn()
        .mockImplementation(
          (_url: string, init: RequestInit, apiKeyIndex?: number) => {
            // Verify apiKeyIndex is passed correctly
            expect(apiKeyIndex).toBe(2);
            return Promise.resolve(new Response(JSON.stringify({ data: [] })));
          },
        ),
      convertModelsToOpenAIFormat: vi.fn().mockReturnValue({
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

    const response = await handleModelsRequest({ apiKeyIndex: 2 } as any);
    const body = (await response.json()) as ModelsResponse;

    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("test/test-model");
    expect(testProviderClass.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      2,
    );
  });

  it("bounds both per-provider model count and aggregate output size", async () => {
    Object.keys(BUILT_IN_PROVIDER_CONSTRUCTORS).forEach((key) => {
      delete BUILT_IN_PROVIDER_CONSTRUCTORS[key];
    });
    const boundedProvider = {
      ...mockProviderClass,
      convertModelsToOpenAIFormat: vi.fn().mockReturnValue({
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
    };
    BUILT_IN_PROVIDER_CONSTRUCTORS.test =
      mockProviderConstructor(boundedProvider);

    const response = await handleModelsRequest({} as any);
    const body = (await response.json()) as ModelsResponse;
    expect(body.data).toHaveLength(MAX_MODELS_PER_PROVIDER);

    boundedProvider.convertModelsToOpenAIFormat.mockReturnValue({
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
    const truncatedResponse = await handleModelsRequest({} as any);
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

    it("stores successful aggregates and serves subsequent requests from the cache", async () => {
      const waitUntil = vi.fn();
      const context = { ctx: { waitUntil }, apiKeyIndex: 11 } as any;

      const missResponse = await handleModelsRequest(context);
      expect(missResponse.headers.get("X-Proxy-Models-Cache")).toBe("MISS");
      expect(waitUntil).toHaveBeenCalledOnce();
      await waitUntil.mock.calls[0][0];
      const upstreamCalls = mockProviderClass.fetch.mock.calls.length;

      const hitResponse = await handleModelsRequest(context);
      expect(hitResponse.headers.get("X-Proxy-Models-Cache")).toBe("HIT");
      expect(hitResponse.headers.get("Cache-Control")).toBeNull();
      expect(hitResponse.headers.get("Content-Type")).toBe("application/json");
      expect(mockProviderClass.fetch.mock.calls.length).toBe(upstreamCalls);
      await expect(hitResponse.json()).resolves.toEqual(
        await missResponse.json(),
      );
    });

    it("awaits the cache write when no execution context is available", async () => {
      const context = { apiKeyIndex: 12 } as any;

      const missResponse = await handleModelsRequest(context);
      expect(missResponse.headers.get("X-Proxy-Models-Cache")).toBe("MISS");

      const hitResponse = await handleModelsRequest(context);
      expect(hitResponse.headers.get("X-Proxy-Models-Cache")).toBe("HIT");
    });

    it("bypasses the cache when the client sends Cache-Control: no-store", async () => {
      const bypassResponse = await handleModelsRequest({
        apiKeyIndex: 13,
        request: new Request("https://example.com/models", {
          headers: { "Cache-Control": "no-store" },
        }),
      } as any);
      expect(bypassResponse.headers.get("X-Proxy-Models-Cache")).toBeNull();

      // Nothing was stored, so a cache-enabled request still misses.
      const missResponse = await handleModelsRequest({
        apiKeyIndex: 13,
      } as any);
      expect(missResponse.headers.get("X-Proxy-Models-Cache")).toBe("MISS");
    });

    it("refreshes the cache when the client sends Cache-Control: no-cache", async () => {
      const primeResponse = await handleModelsRequest({
        apiKeyIndex: 14,
      } as any);
      expect(primeResponse.headers.get("X-Proxy-Models-Cache")).toBe("MISS");

      mockProviderClass.convertModelsToOpenAIFormat.mockReturnValue({
        object: "list",
        data: [
          { id: "fresh-model", object: "model", created: 1, owned_by: "test" },
        ],
      });
      const refreshResponse = await handleModelsRequest({
        apiKeyIndex: 14,
        request: new Request("https://example.com/models", {
          headers: { "Cache-Control": "no-cache" },
        }),
      } as any);
      expect(refreshResponse.headers.get("X-Proxy-Models-Cache")).toBe("MISS");

      const hitResponse = await handleModelsRequest({ apiKeyIndex: 14 } as any);
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

      const missResponse = await handleModelsRequest(
        { request: new Request("https://example.com/g/gw-a/models") } as any,
        gateway("gw-a", false),
      );
      expect(missResponse.headers.get("X-Proxy-Models-Cache")).toBe("MISS");

      const hitResponse = await handleModelsRequest(
        {} as any,
        gateway("gw-a", false),
      );
      expect(hitResponse.headers.get("X-Proxy-Models-Cache")).toBe("HIT");

      const otherGatewayResponse = await handleModelsRequest(
        {} as any,
        gateway("gw-b", false),
      );
      expect(otherGatewayResponse.headers.get("X-Proxy-Models-Cache")).toBe(
        "MISS",
      );

      const alwaysUseResponse = await handleModelsRequest(
        {} as any,
        gateway("gw-a", true),
      );
      expect(alwaysUseResponse.headers.get("X-Proxy-Models-Cache")).toBe(
        "MISS",
      );
    });

    it("scopes cache entries by key selection", async () => {
      const missResponse = await handleModelsRequest({
        apiKeyIndex: { start: 1 },
      } as any);
      expect(missResponse.headers.get("X-Proxy-Models-Cache")).toBe("MISS");

      const hitResponse = await handleModelsRequest({
        apiKeyIndex: { start: 1 },
      } as any);
      expect(hitResponse.headers.get("X-Proxy-Models-Cache")).toBe("HIT");

      const rangeResponse = await handleModelsRequest({
        apiKeyIndex: { start: 1, end: 2 },
      } as any);
      expect(rangeResponse.headers.get("X-Proxy-Models-Cache")).toBe("MISS");

      const endOnlyResponse = await handleModelsRequest({
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

      const bypassResponse = await handleModelsRequest(
        {
          request: new Request("https://example.com/g/gw-tuning/models", {
            headers: { "cf-aig-metadata": '{"caller":"test"}' },
          }),
        } as any,
        aiGateway,
      );
      expect(bypassResponse.headers.get("X-Proxy-Models-Cache")).toBeNull();

      const missResponse = await handleModelsRequest({} as any, aiGateway);
      expect(missResponse.headers.get("X-Proxy-Models-Cache")).toBe("MISS");
    });

    it("does not cache aggregates with a failed provider", async () => {
      const errorProviderClass = {
        ...mockProviderClass,
        fetch: vi.fn().mockRejectedValue(new Error("Network error")),
      };
      Object.keys(BUILT_IN_PROVIDER_CONSTRUCTORS).forEach((key) => {
        delete BUILT_IN_PROVIDER_CONSTRUCTORS[key];
      });
      BUILT_IN_PROVIDER_CONSTRUCTORS.openai =
        mockProviderConstructor(mockProviderClass);
      BUILT_IN_PROVIDER_CONSTRUCTORS.error =
        mockProviderConstructor(errorProviderClass);
      vi.spyOn(console, "error").mockImplementation(() => {});

      const missResponse = await handleModelsRequest({
        apiKeyIndex: 31,
      } as any);
      expect(missResponse.headers.get("X-Proxy-Models-Cache")).toBe("MISS");

      const uncachedResponse = await handleModelsRequest({
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
        convertModelsToOpenAIFormat: vi.fn().mockReturnValue({
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
      };
      BUILT_IN_PROVIDER_CONSTRUCTORS.test =
        mockProviderConstructor(oversizedProvider);
      vi.spyOn(console, "warn").mockImplementation(() => {});

      const truncatedResponse = await handleModelsRequest({
        apiKeyIndex: 32,
      } as any);
      expect(truncatedResponse.headers.get("X-Proxy-Models-Truncated")).toBe(
        "true",
      );
      expect(truncatedResponse.headers.get("X-Proxy-Models-Cache")).toBe(
        "MISS",
      );

      const uncachedResponse = await handleModelsRequest({
        apiKeyIndex: 32,
      } as any);
      expect(uncachedResponse.headers.get("X-Proxy-Models-Cache")).toBe("MISS");
    });
  });
});
