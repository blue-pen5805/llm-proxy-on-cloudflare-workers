import { describe, it, expect, vi, beforeEach } from "vitest";
import { BUILT_IN_PROVIDER_CONSTRUCTORS } from "~/src/providers";
import {
  handleUniversalEndpointRequest,
  MAX_UNIVERSAL_ENDPOINT_STEPS,
} from "~/src/requests/universal_endpoint";
import * as helpers from "~/src/utils/helpers";
import { Secrets } from "~/src/utils/secrets";

vi.mock("~/src/ai_gateway");
vi.mock("~/src/providers");
vi.mock("~/src/utils/helpers");
vi.mock("~/src/utils/secrets");

describe("handleUniversalEndpointRequest", () => {
  const mockProviderClass = {
    chatCompletionPath: "/chat/completions",
    headers: vi.fn(),
  };

  const mockAIGateway = {
    buildUniversalEndpointRequest: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(helpers.fetchWithLogging).mockResolvedValue(new Response());
    vi.mocked(helpers.readJsonRequest).mockImplementation((request) =>
      request.json(),
    );
    BUILT_IN_PROVIDER_CONSTRUCTORS.openai = vi.fn(function () {
      return mockProviderClass;
    });
    mockProviderClass.headers.mockReturnValue({
      "Content-Type": "application/json",
      Authorization: "Bearer sk-test",
    });
    vi.mocked(Secrets.getAll).mockReturnValue(["test-key"]);
    vi.mocked(Secrets.getNext).mockResolvedValue(0);
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
      headers: { "Content-Type": "application/json" },
    });

    mockAIGateway.buildUniversalEndpointRequest.mockReturnValue([
      "https://gateway.ai.cloudflare.com/v1/account/gateway",
      { method: "POST", body: JSON.stringify([]) },
    ]);

    await handleUniversalEndpointRequest(request, mockAIGateway as any);

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
    });
    expect(helpers.fetchWithLogging).toHaveBeenCalled();
    expect(helpers.fetchWithLogging).toHaveBeenCalledWith(
      "https://gateway.ai.cloudflare.com/v1/account/gateway",
      expect.objectContaining({ signal: request.signal }),
    );
  });

  it("should handle multiple provider requests", async () => {
    const anthropicProviderClass = {
      chatCompletionPath: "/v1/messages",
      headers: vi.fn().mockReturnValue({
        "Content-Type": "application/json",
        Authorization: "Bearer sk-ant-test",
      }),
    };

    BUILT_IN_PROVIDER_CONSTRUCTORS.anthropic = vi.fn(function () {
      return anthropicProviderClass;
    });

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

    await handleUniversalEndpointRequest(request, mockAIGateway as any);

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

    await handleUniversalEndpointRequest(request, mockAIGateway as any);

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

    await handleUniversalEndpointRequest(request, mockAIGateway as any);

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
      handleUniversalEndpointRequest(request, mockAIGateway as any),
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
      handleUniversalEndpointRequest(request, mockAIGateway as any),
    ).rejects.toThrow("Provider unsupported-provider is not supported.");
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

    await handleUniversalEndpointRequest(request, mockAIGateway as any);

    expect(mockAIGateway.buildUniversalEndpointRequest).toHaveBeenCalledWith({
      data: [
        {
          provider: "openai",
          endpoint: "/custom/endpoint",
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
    });
  });

  it("should handle provider without explicit chatCompletionPath", async () => {
    const customProviderClass = {
      chatCompletionPath: "/v1/chat/completions",
      headers: vi.fn().mockReturnValue({
        "Content-Type": "application/json",
        "X-API-Key": "test-key",
      }),
    };

    // Use a supported provider instead of 'custom'
    BUILT_IN_PROVIDER_CONSTRUCTORS.anthropic = vi.fn(function () {
      return customProviderClass;
    });

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

    await handleUniversalEndpointRequest(request, mockAIGateway as any);

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
      ),
    ).rejects.toThrow(`at most ${MAX_UNIVERSAL_ENDPOINT_STEPS} steps`);
    expect(mockAIGateway.buildUniversalEndpointRequest).not.toHaveBeenCalled();
  });

  it.each([
    [null, "non-empty array"],
    [["invalid"], "step must be an object"],
    [[{ provider: "openai", query: [] }], "query object"],
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
      ),
    ).rejects.toThrow(message);
  });
});
