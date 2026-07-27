import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleUniversalEndpointRequest,
  MAX_UNIVERSAL_ENDPOINT_STEPS,
} from "~/src/requests/universal_endpoint";
import { BadRequestError } from "~/src/utils/error";
import * as helpers from "~/src/utils/helpers";

vi.mock("~/src/ai_gateway");
vi.mock("~/src/utils/helpers");

describe("handleUniversalEndpointRequest", () => {
  const universalMetadataHeaders = {
    "cf-aig-metadata": '{"llm_proxy_endpoint":"universal_endpoint"}',
  };
  const mockProviderClass = {
    chatCompletionPath: "/chat/completions",
    headers: vi.fn(),
    getNextApiKeyIndex: vi.fn(),
    getApiKeys: vi.fn(),
  };

  const mockAIGateway = {
    buildUniversalEndpointRequest: vi.fn(),
  };
  const providerInstances: Record<string, typeof mockProviderClass> = {};
  const mockProviderRegistry = {
    get: vi.fn((providerName: string) => providerInstances[providerName]),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(helpers.fetchWithLogging).mockResolvedValue(new Response());
    vi.mocked(helpers.readJsonRequest).mockImplementation((request) =>
      request.json(),
    );
    for (const providerName of Object.keys(providerInstances)) {
      delete providerInstances[providerName];
    }
    providerInstances.openai = mockProviderClass;
    mockProviderClass.headers.mockReturnValue({
      "Content-Type": "application/json",
      Authorization: "Bearer sk-test",
    });
    mockProviderClass.getApiKeys.mockReturnValue(["test-key"]);
    mockProviderClass.getNextApiKeyIndex.mockResolvedValue(0);
  });

  it("should handle single provider request", async () => {
    const requestBody = [
      {
        provider: "openai",
        query: {
          model: "gpt-4",
          messages: [{ role: "user", content: "Hello" }],
        },
      },
    ];

    const request = new Request("https://example.com", {
      method: "POST",
      body: JSON.stringify(requestBody),
      headers: {
        "Content-Type": "application/json",
        "cf-aig-metadata": '{"tenant":"example"}',
      },
    });

    mockAIGateway.buildUniversalEndpointRequest.mockReturnValue([
      "https://gateway.ai.cloudflare.com/v1/account/gateway",
      { method: "POST", body: JSON.stringify([]) },
    ]);

    await handleUniversalEndpointRequest(
      request,
      mockAIGateway as any,
      mockProviderRegistry as any,
    );

    expect(mockAIGateway.buildUniversalEndpointRequest).toHaveBeenCalledWith({
      data: [
        {
          provider: "openai",
          endpoint: "chat/completions",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer sk-test",
          },
          query: {
            model: "gpt-4",
            messages: [{ role: "user", content: "Hello" }],
          },
        },
      ],
      headers: {
        "cf-aig-metadata":
          '{"tenant":"example","llm_proxy_endpoint":"universal_endpoint"}',
      },
    });
    expect(helpers.fetchWithLogging).toHaveBeenCalled();
    expect(helpers.fetchWithLogging).toHaveBeenCalledWith(
      "https://gateway.ai.cloudflare.com/v1/account/gateway",
      expect.objectContaining({ signal: request.signal }),
    );
  });

  it("uses a named provider profile while emitting the base Gateway provider", async () => {
    providerInstances["openai:paid"] = {
      ...mockProviderClass,
      getNextApiKeyIndex: vi.fn().mockResolvedValue(0),
      getApiKeys: vi.fn().mockReturnValue(["paid-key"]),
      headers: vi.fn().mockResolvedValue({ Authorization: "Bearer paid-key" }),
    } as never;
    mockAIGateway.buildUniversalEndpointRequest.mockReturnValue([
      "https://gateway.example",
      { method: "POST" },
    ]);
    const request = new Request("https://example.com", {
      method: "POST",
      body: JSON.stringify([
        { provider: "openai:paid", query: { model: "gpt-4o" } },
      ]),
    });

    await handleUniversalEndpointRequest(
      request,
      mockAIGateway as any,
      mockProviderRegistry as any,
    );

    expect(mockProviderRegistry.get).toHaveBeenCalledWith("openai:paid");
    expect(
      providerInstances["openai:paid"].getNextApiKeyIndex,
    ).toHaveBeenCalledOnce();
    expect(providerInstances["openai:paid"].getApiKeys).toHaveBeenCalledOnce();
    expect(mockAIGateway.buildUniversalEndpointRequest).toHaveBeenCalledWith({
      data: [expect.objectContaining({ provider: "openai" })],
      headers: universalMetadataHeaders,
    });
  });

  it("uses provider-native profile rotation and key access when available", async () => {
    const profiledProvider = {
      ...mockProviderClass,
      getNextApiKeyIndex: vi.fn().mockResolvedValue(1),
      getApiKeys: vi.fn().mockReturnValue(["paid-one", "paid-two"]),
      headers: vi.fn().mockResolvedValue({ Authorization: "Bearer paid-two" }),
    };
    providerInstances["openai:paid"] = profiledProvider as never;
    mockAIGateway.buildUniversalEndpointRequest.mockReturnValue([
      "https://gateway.example",
      { method: "POST" },
    ]);

    await handleUniversalEndpointRequest(
      new Request("https://example.com", {
        method: "POST",
        body: JSON.stringify([
          { provider: "openai:paid", query: { model: "gpt-4o" } },
        ]),
      }),
      mockAIGateway as any,
      mockProviderRegistry as any,
    );

    expect(profiledProvider.getNextApiKeyIndex).toHaveBeenCalledOnce();
    expect(profiledProvider.getApiKeys).toHaveBeenCalledOnce();
  });

  it("should handle multiple provider requests", async () => {
    const anthropicProviderClass = {
      chatCompletionPath: "/v1/messages",
      getNextApiKeyIndex: vi.fn().mockResolvedValue(0),
      getApiKeys: vi.fn().mockReturnValue(["sk-ant-test"]),
      headers: vi.fn().mockReturnValue({
        "Content-Type": "application/json",
        Authorization: "Bearer sk-ant-test",
      }),
    };

    providerInstances.anthropic = anthropicProviderClass;

    const requestBody = [
      {
        provider: "openai",
        query: {
          model: "gpt-4",
          messages: [{ role: "user", content: "Hello" }],
        },
      },
      {
        provider: "anthropic",
        query: {
          model: "claude-3-opus-20240229",
          messages: [{ role: "user", content: "Hello" }],
        },
      },
    ];

    const request = new Request("https://example.com", {
      method: "POST",
      body: JSON.stringify(requestBody),
      headers: { "Content-Type": "application/json" },
    });

    mockAIGateway.buildUniversalEndpointRequest.mockReturnValue([
      "https://gateway.ai.cloudflare.com/v1/account/gateway",
      { method: "POST", body: JSON.stringify([]) },
    ]);

    await handleUniversalEndpointRequest(
      request,
      mockAIGateway as any,
      mockProviderRegistry as any,
    );

    expect(mockAIGateway.buildUniversalEndpointRequest).toHaveBeenCalledWith({
      data: [
        {
          provider: "openai",
          endpoint: "chat/completions",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer sk-test",
          },
          query: {
            model: "gpt-4",
            messages: [{ role: "user", content: "Hello" }],
          },
        },
        {
          provider: "anthropic",
          endpoint: "v1/messages",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer sk-ant-test",
          },
          query: {
            model: "claude-3-opus-20240229",
            messages: [{ role: "user", content: "Hello" }],
          },
        },
      ],
      headers: universalMetadataHeaders,
    });
  });

  it("should use custom endpoint when provided", async () => {
    const requestBody = [
      {
        provider: "openai",
        endpoint: "completions",
        query: {
          model: "gpt-3.5-turbo-instruct",
          prompt: "Hello",
        },
      },
    ];

    const request = new Request("https://example.com", {
      method: "POST",
      body: JSON.stringify(requestBody),
      headers: { "Content-Type": "application/json" },
    });

    mockAIGateway.buildUniversalEndpointRequest.mockReturnValue([
      "https://gateway.ai.cloudflare.com/v1/account/gateway",
      { method: "POST", body: JSON.stringify([]) },
    ]);

    await handleUniversalEndpointRequest(
      request,
      mockAIGateway as any,
      mockProviderRegistry as any,
    );

    expect(mockAIGateway.buildUniversalEndpointRequest).toHaveBeenCalledWith({
      data: [
        {
          provider: "openai",
          endpoint: "completions",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer sk-test",
          },
          query: {
            model: "gpt-3.5-turbo-instruct",
            prompt: "Hello",
          },
        },
      ],
      headers: universalMetadataHeaders,
    });
  });

  it("should merge custom headers with provider headers", async () => {
    const requestBody = [
      {
        provider: "openai",
        headers: {
          "X-Custom-Header": "custom-value",
          Authorization: "Bearer custom-token",
        },
        query: {
          model: "gpt-4",
          messages: [{ role: "user", content: "Hello" }],
        },
      },
    ];

    const request = new Request("https://example.com", {
      method: "POST",
      body: JSON.stringify(requestBody),
      headers: { "Content-Type": "application/json" },
    });

    mockAIGateway.buildUniversalEndpointRequest.mockReturnValue([
      "https://gateway.ai.cloudflare.com/v1/account/gateway",
      { method: "POST", body: JSON.stringify([]) },
    ]);

    await handleUniversalEndpointRequest(
      request,
      mockAIGateway as any,
      mockProviderRegistry as any,
    );

    expect(mockAIGateway.buildUniversalEndpointRequest).toHaveBeenCalledWith({
      data: [
        {
          provider: "openai",
          endpoint: "chat/completions",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer sk-test",
            "x-custom-header": "custom-value",
          },
          query: {
            model: "gpt-4",
            messages: [{ role: "user", content: "Hello" }],
          },
        },
      ],
      headers: universalMetadataHeaders,
    });
  });

  it("should throw error when provider is not specified", async () => {
    const requestBody = [
      {
        query: {
          model: "gpt-4",
          messages: [{ role: "user", content: "Hello" }],
        },
      },
    ];

    const request = new Request("https://example.com", {
      method: "POST",
      body: JSON.stringify(requestBody),
      headers: { "Content-Type": "application/json" },
    });

    await expect(
      handleUniversalEndpointRequest(
        request,
        mockAIGateway as any,
        mockProviderRegistry as any,
      ),
    ).rejects.toThrow("Each Universal Endpoint step requires a provider.");
  });

  it("should throw error when provider is not supported", async () => {
    const requestBody = [
      {
        provider: "unsupported-provider",
        query: {
          model: "some-model",
          messages: [{ role: "user", content: "Hello" }],
        },
      },
    ];

    const request = new Request("https://example.com", {
      method: "POST",
      body: JSON.stringify(requestBody),
      headers: { "Content-Type": "application/json" },
    });

    await expect(
      handleUniversalEndpointRequest(
        request,
        mockAIGateway as any,
        mockProviderRegistry as any,
      ),
    ).rejects.toThrow("Provider unsupported-provider is not supported.");
  });

  it("rejects a malformed provider profile selector", async () => {
    const request = new Request("https://example.com", {
      method: "POST",
      body: JSON.stringify([
        { provider: "openai:bad/profile", query: { model: "gpt-4o" } },
      ]),
    });

    await expect(
      handleUniversalEndpointRequest(
        request,
        mockAIGateway as any,
        mockProviderRegistry as any,
      ),
    ).rejects.toThrow("Provider openai:bad/profile is not supported.");
  });

  it("rejects a Gateway provider that has no local adapter", async () => {
    const request = new Request("https://example.com", {
      method: "POST",
      body: JSON.stringify([{ provider: "cartesia", query: {} }]),
      headers: { "Content-Type": "application/json" },
    });

    const result = handleUniversalEndpointRequest(
      request,
      mockAIGateway as any,
      mockProviderRegistry as any,
    );

    await expect(result).rejects.toMatchObject({
      name: BadRequestError.name,
      message: "Provider cartesia is not supported by this proxy.",
      status: 400,
    });
    expect(mockAIGateway.buildUniversalEndpointRequest).not.toHaveBeenCalled();
  });

  it("should remove leading slash from endpoint", async () => {
    const requestBody = [
      {
        provider: "openai",
        endpoint: "/custom/endpoint",
        query: {
          model: "gpt-4",
          messages: [{ role: "user", content: "Hello" }],
        },
      },
    ];

    const request = new Request("https://example.com", {
      method: "POST",
      body: JSON.stringify(requestBody),
      headers: { "Content-Type": "application/json" },
    });

    mockAIGateway.buildUniversalEndpointRequest.mockReturnValue([
      "https://gateway.ai.cloudflare.com/v1/account/gateway",
      { method: "POST", body: JSON.stringify([]) },
    ]);

    await handleUniversalEndpointRequest(
      request,
      mockAIGateway as any,
      mockProviderRegistry as any,
    );

    expect(mockAIGateway.buildUniversalEndpointRequest).toHaveBeenCalledWith({
      data: [
        {
          provider: "openai",
          endpoint: "custom/endpoint",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer sk-test",
          },
          query: {
            model: "gpt-4",
            messages: [{ role: "user", content: "Hello" }],
          },
        },
      ],
      headers: universalMetadataHeaders,
    });
  });

  it.each([
    "",
    "https://attacker.example/v1",
    "../chat/completions",
    "v1/../chat/completions",
    "v1\\chat\\completions",
    "v1/chat\ncompletions",
  ])("rejects unsafe Universal Endpoint path %j", async (endpoint) => {
    vi.mocked(helpers.readJsonRequest).mockResolvedValueOnce([
      { provider: "openai", endpoint, query: {} },
    ]);

    await expect(
      handleUniversalEndpointRequest(
        new Request("https://example.com", { method: "POST" }),
        mockAIGateway as any,
        mockProviderRegistry as any,
      ),
    ).rejects.toThrow("safe relative path");
    expect(mockAIGateway.buildUniversalEndpointRequest).not.toHaveBeenCalled();
  });

  it("should handle provider without explicit chatCompletionPath", async () => {
    const customProviderClass = {
      chatCompletionPath: "/v1/chat/completions",
      getNextApiKeyIndex: vi.fn().mockResolvedValue(0),
      getApiKeys: vi.fn().mockReturnValue(["test-key"]),
      headers: vi.fn().mockReturnValue({
        "Content-Type": "application/json",
        "X-API-Key": "test-key",
      }),
    };

    // Use a supported provider instead of 'custom'
    providerInstances.anthropic = customProviderClass;

    const requestBody = [
      {
        provider: "anthropic",
        query: {
          model: "claude-3-opus",
          messages: [{ role: "user", content: "Hello" }],
        },
      },
    ];

    const request = new Request("https://example.com", {
      method: "POST",
      body: JSON.stringify(requestBody),
      headers: { "Content-Type": "application/json" },
    });

    mockAIGateway.buildUniversalEndpointRequest.mockReturnValue([
      "https://gateway.ai.cloudflare.com/v1/account/gateway",
      { method: "POST", body: JSON.stringify([]) },
    ]);

    await handleUniversalEndpointRequest(
      request,
      mockAIGateway as any,
      mockProviderRegistry as any,
    );

    expect(mockAIGateway.buildUniversalEndpointRequest).toHaveBeenCalledWith({
      data: [
        {
          provider: "anthropic",
          endpoint: "v1/chat/completions",
          headers: {
            "content-type": "application/json",
            "x-api-key": "test-key",
          },
          query: {
            model: "claude-3-opus",
            messages: [{ role: "user", content: "Hello" }],
          },
        },
      ],
      headers: universalMetadataHeaders,
    });
  });

  it("rejects excessive fallback fan-out", async () => {
    vi.mocked(helpers.readJsonRequest).mockResolvedValueOnce(
      Array.from({ length: MAX_UNIVERSAL_ENDPOINT_STEPS + 1 }, () => ({
        provider: "openai",
        query: {},
      })),
    );

    await expect(
      handleUniversalEndpointRequest(
        new Request("https://example.com", { method: "POST" }),
        mockAIGateway as any,
        mockProviderRegistry as any,
      ),
    ).rejects.toThrow(`at most ${MAX_UNIVERSAL_ENDPOINT_STEPS} steps`);
    expect(mockAIGateway.buildUniversalEndpointRequest).not.toHaveBeenCalled();
  });

  it.each([
    [null, "non-empty array"],
    [["invalid"], "step must be an object"],
    [[{ provider: "openai", query: [] }], "query object"],
    [[{ provider: "openai", endpoint: 42, query: {} }], "must be a string"],
    [[{ provider: "openai", query: {}, headers: [] }], "must be an object"],
    [
      [{ provider: "openai", query: {}, headers: { invalid: 1 } }],
      "header values must be strings",
    ],
  ])("rejects malformed Universal Endpoint input", async (body, message) => {
    vi.mocked(helpers.readJsonRequest).mockResolvedValueOnce(body);
    await expect(
      handleUniversalEndpointRequest(
        new Request("https://example.com", { method: "POST" }),
        mockAIGateway as any,
        mockProviderRegistry as any,
      ),
    ).rejects.toThrow(message);
  });
});
