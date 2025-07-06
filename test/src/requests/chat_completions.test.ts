import { describe, it, expect, vi, beforeEach } from "vitest";
import { CloudflareAIGateway } from "~/src/ai_gateway";
import { Providers } from "~/src/providers";
import { chatCompletions } from "~/src/requests/chat_completions";
import { Config } from "~/src/utils/config";
import * as helpers from "~/src/utils/helpers";

vi.mock("~/src/ai_gateway");
vi.mock("~/src/providers");
vi.mock("~/src/utils/config");
vi.mock("~/src/utils/helpers");

describe("chatCompletions", () => {
  const mockProviderClass = {
    buildChatCompletionsRequest: vi.fn(),
    fetch: vi.fn(),
    apiKeyName: "OPENAI_API_KEY",
  };

  const mockAIGateway = {
    buildChatCompletionsRequest: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(helpers.safeJsonParse).mockImplementation((str) => {
      try {
        return JSON.parse(str);
      } catch {
        return str;
      }
    });
    vi.mocked(helpers.fetch2).mockResolvedValue(new Response());
    vi.mocked(CloudflareAIGateway.isSupportedProvider).mockReturnValue(true);
    Providers.openai = vi.fn().mockReturnValue(mockProviderClass);
    vi.mocked(Config.defaultModel).mockReturnValue("openai/gpt-4");
  });

  it("should handle valid chat completions request", async () => {
    const requestBody = {
      model: "openai/gpt-4",
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

    await chatCompletions(request);

    expect(mockProviderClass.buildChatCompletionsRequest).toHaveBeenCalledWith({
      body: JSON.stringify({ ...requestBody, model: "gpt-4" }),
      headers: expect.any(Headers),
    });
    expect(mockProviderClass.fetch).toHaveBeenCalled();
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

    await chatCompletions(request);

    expect(Config.defaultModel).toHaveBeenCalled();
    expect(mockProviderClass.buildChatCompletionsRequest).toHaveBeenCalledWith({
      body: JSON.stringify({ ...requestBody, model: "gpt-4" }),
      headers: expect.any(Headers),
    });
  });

  it("should return 400 for invalid JSON", async () => {
    const request = new Request("https://example.com/chat/completions", {
      method: "POST",
      body: "invalid json",
      headers: { "Content-Type": "application/json" },
    });

    const response = await chatCompletions(request);

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("Invalid request.");
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

    const response = await chatCompletions(request);

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("Invalid provider.");
  });

  it("should use AI Gateway when available and provider supported", async () => {
    const requestBody = {
      model: "openai/gpt-4",
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
    mockAIGateway.buildChatCompletionsRequest.mockReturnValue([
      "https://gateway.ai.cloudflare.com/v1/account/gateway",
      { method: "POST", body: JSON.stringify([]) },
    ]);

    await chatCompletions(request, mockAIGateway as any);

    expect(CloudflareAIGateway.isSupportedProvider).toHaveBeenCalledWith(
      "openai",
      true,
    );
    expect(mockAIGateway.buildChatCompletionsRequest).toHaveBeenCalledWith({
      provider: "openai",
      body: JSON.stringify({ ...requestBody, model: "gpt-4" }),
      headers: expect.any(Object),
      apiKeyName: "OPENAI_API_KEY",
    });
    expect(helpers.fetch2).toHaveBeenCalled();
  });

  it("should remove Authorization header", async () => {
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

    await chatCompletions(request);

    const headersArg =
      mockProviderClass.buildChatCompletionsRequest.mock.calls[0][0].headers;
    expect(headersArg.has("Authorization")).toBe(false);
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

    await chatCompletions(request);

    expect(mockProviderClass.buildChatCompletionsRequest).toHaveBeenCalledWith({
      body: JSON.stringify({ ...requestBody, model: "gpt-4/turbo" }),
      headers: expect.any(Headers),
    });
  });
});
