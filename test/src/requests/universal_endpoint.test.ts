import { describe, it, expect, vi, beforeEach } from "vitest";
import { Providers } from "~/src/providers";
import { universalEndpoint } from "~/src/requests/universal_endpoint";
import * as helpers from "~/src/utils/helpers";
import { Secrets } from "~/src/utils/secrets";

vi.mock("~/src/ai_gateway");
vi.mock("~/src/providers");
vi.mock("~/src/utils/helpers");
vi.mock("~/src/utils/secrets");

describe("universalEndpoint", () => {
  const mockProviderClass = {
    chatCompletionPath: "/chat/completions",
    headers: vi.fn(),
  };

  const mockAIGateway = {
    buildUniversalEndpointRequest: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(helpers.fetch2).mockResolvedValue(new Response());
    Providers.openai = vi.fn().mockReturnValue(mockProviderClass);
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

    await universalEndpoint(request, mockAIGateway as any);

    expect(mockAIGateway.buildUniversalEndpointRequest).toHaveBeenCalledWith({
      data: [
        {
          provider: "openai",
          endpoint: "chat/completions",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer sk-test",
          },
          query: {
            model: "gpt-4",
            messages: [{ role: "user", content: "Hello" }],
          },
        },
      ],
    });
    expect(helpers.fetch2).toHaveBeenCalled();
  });

  it("should handle multiple provider requests", async () => {
    const anthropicProviderClass = {
      chatCompletionPath: "/v1/messages",
      headers: vi.fn().mockReturnValue({
        "Content-Type": "application/json",
        Authorization: "Bearer sk-ant-test",
      }),
    };

    Providers.anthropic = vi.fn().mockReturnValue(anthropicProviderClass);

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

    await universalEndpoint(request, mockAIGateway as any);

    expect(mockAIGateway.buildUniversalEndpointRequest).toHaveBeenCalledWith({
      data: [
        {
          provider: "openai",
          endpoint: "chat/completions",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer sk-test",
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
            "Content-Type": "application/json",
            Authorization: "Bearer sk-ant-test",
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

    await universalEndpoint(request, mockAIGateway as any);

    expect(mockAIGateway.buildUniversalEndpointRequest).toHaveBeenCalledWith({
      data: [
        {
          provider: "openai",
          endpoint: "completions",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer sk-test",
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

    await universalEndpoint(request, mockAIGateway as any);

    expect(mockAIGateway.buildUniversalEndpointRequest).toHaveBeenCalledWith({
      data: [
        {
          provider: "openai",
          endpoint: "chat/completions",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer custom-token",
            "X-Custom-Header": "custom-value",
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
      universalEndpoint(request, mockAIGateway as any),
    ).rejects.toThrow("Provider not specified.");
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
      universalEndpoint(request, mockAIGateway as any),
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

    await universalEndpoint(request, mockAIGateway as any);

    expect(mockAIGateway.buildUniversalEndpointRequest).toHaveBeenCalledWith({
      data: [
        {
          provider: "openai",
          endpoint: "/custom/endpoint",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer sk-test",
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
    Providers.anthropic = vi.fn().mockReturnValue(customProviderClass);

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

    await universalEndpoint(request, mockAIGateway as any);

    expect(mockAIGateway.buildUniversalEndpointRequest).toHaveBeenCalledWith({
      data: [
        {
          provider: "anthropic",
          endpoint: "v1/chat/completions",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": "test-key",
          },
          query: {
            model: "claude-3-opus",
            messages: [{ role: "user", content: "Hello" }],
          },
        },
      ],
    });
  });
});
