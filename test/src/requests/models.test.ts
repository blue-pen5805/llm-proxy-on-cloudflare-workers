import { describe, it, expect, vi, beforeEach } from "vitest";
import { CloudflareAIGateway } from "~/src/ai_gateway";
import { BUILT_IN_PROVIDER_CONSTRUCTORS } from "~/src/providers";
import { getAllProviderInstances, getProviderByName } from "~/src/providers";
import { ProviderNotSupportedError } from "~/src/providers/provider";
import {
  handleModelsRequest,
  MAX_AGGREGATED_MODELS_BYTES,
  MAX_MODELS_PER_PROVIDER,
} from "~/src/requests/models";
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

    // Clear the built-in provider constructor map.
    Object.keys(BUILT_IN_PROVIDER_CONSTRUCTORS).forEach((key) => {
      delete BUILT_IN_PROVIDER_CONSTRUCTORS[key];
    });

    // Provide withTimeout implementation to the mocked helpers module
    if (helpers.withTimeout !== undefined) {
      vi.mocked(helpers.withTimeout).mockImplementation(
        async (promise: Promise<any>, abortController: AbortController) => {
          return promise;
        },
      );
    }
    vi.mocked(helpers.readResponseJson).mockImplementation((response) =>
      response.json(),
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
    const timeoutPromise = vi.mocked(helpers.withTimeout).mock.calls[0][0];

    await expect(timeoutPromise).resolves.toBe(formattedModels);
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
});
