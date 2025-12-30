import { describe, it, expect, vi, beforeEach } from "vitest";
import { CloudflareAIGateway } from "~/src/ai_gateway";
import { Secrets } from "~/src/utils/secrets";

vi.mock("~/src/utils/secrets", () => ({
  Secrets: {
    getAll: vi.fn(),
  },
}));

describe("CloudflareAIGateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isSupportedProvider", () => {
    it("should return true for valid providers", () => {
      expect(CloudflareAIGateway.isSupportedProvider("openai")).toBe(true);
      expect(CloudflareAIGateway.isSupportedProvider("anthropic")).toBe(true);
      expect(CloudflareAIGateway.isSupportedProvider("groq")).toBe(true);
    });

    it("should return false for invalid providers", () => {
      expect(CloudflareAIGateway.isSupportedProvider("invalid")).toBe(false);
      expect(CloudflareAIGateway.isSupportedProvider("")).toBe(false);
    });

    it("should return true for OpenAI compatible providers when hasOpenAiCompatibility is true", () => {
      expect(CloudflareAIGateway.isSupportedProvider("openai", true)).toBe(
        true,
      );
      expect(CloudflareAIGateway.isSupportedProvider("anthropic", true)).toBe(
        true,
      );
      expect(CloudflareAIGateway.isSupportedProvider("groq", true)).toBe(true);
    });

    it("should return false for non-OpenAI compatible providers when hasOpenAiCompatibility is true", () => {
      expect(
        CloudflareAIGateway.isSupportedProvider("azure-openai", true),
      ).toBe(false);
      expect(CloudflareAIGateway.isSupportedProvider("aws-bedrock", true)).toBe(
        false,
      );
      expect(CloudflareAIGateway.isSupportedProvider("replicate", true)).toBe(
        false,
      );
    });
  });

  describe("constructor", () => {
    it("should create instance with provided values", () => {
      const gateway = new CloudflareAIGateway("account", "gateway", "key");

      expect(gateway.accountId).toBe("account");
      expect(gateway.gatewayId).toBe("gateway");
      expect(gateway.apiKey).toBe("key");
    });

    it("should throw error when accountId is missing", () => {
      expect(() => new CloudflareAIGateway("", "gateway")).toThrow(
        "Cloudflare AI Gateway configuration is incomplete. accountId and gatewayId are required.",
      );
    });

    it("should throw error when gatewayId is missing", () => {
      expect(() => new CloudflareAIGateway("account", "")).toThrow(
        "Cloudflare AI Gateway configuration is incomplete. accountId and gatewayId are required.",
      );
    });
  });

  describe("baseUrl", () => {
    let gateway: CloudflareAIGateway;

    beforeEach(() => {
      gateway = new CloudflareAIGateway(
        "test-account",
        "test-gateway",
        "test-key",
      );
    });

    it("should return base URL without provider", () => {
      const url = gateway.baseUrl();
      expect(url).toBe(
        "https://gateway.ai.cloudflare.com/v1/test-account/test-gateway",
      );
    });

    it("should return base URL with provider", () => {
      const url = gateway.baseUrl("openai");
      expect(url).toBe(
        "https://gateway.ai.cloudflare.com/v1/test-account/test-gateway/openai",
      );
    });
  });

  describe("buildHeaders", () => {
    let gateway: CloudflareAIGateway;

    beforeEach(() => {
      gateway = new CloudflareAIGateway(
        "test-account",
        "test-gateway",
        "test-key",
      );
    });

    it("should build headers with default content type and authorization", () => {
      const headers = gateway.buildHeaders();

      expect(headers).toEqual({
        "Content-Type": "application/json",
        "cf-aig-authorization": "Bearer test-key",
      });
    });

    it("should merge additional headers", () => {
      const headers = gateway.buildHeaders({
        "Custom-Header": "custom-value",
        "Another-Header": "another-value",
      });

      expect(headers).toEqual({
        "Content-Type": "application/json",
        "cf-aig-authorization": "Bearer test-key",
        "Custom-Header": "custom-value",
        "Another-Header": "another-value",
      });
    });

    it("should override default headers with additional headers", () => {
      const headers = gateway.buildHeaders({
        "Content-Type": "text/plain",
      });

      expect(headers).toEqual({
        "Content-Type": "text/plain",
        "cf-aig-authorization": "Bearer test-key",
      });
    });
  });

  describe("buildUniversalEndpointRequest", () => {
    let gateway: CloudflareAIGateway;

    beforeEach(() => {
      gateway = new CloudflareAIGateway(
        "test-account",
        "test-gateway",
        "test-key",
      );
    });

    it("should build universal endpoint request with single step", () => {
      const data = {
        provider: "openai" as const,
        endpoint: "chat/completions",
        headers: { authorization: "Bearer sk-test" },
        query: { model: "gpt-4", messages: [] },
      };

      const [url, init] = gateway.buildUniversalEndpointRequest({ data });

      expect(url).toBe(
        "https://gateway.ai.cloudflare.com/v1/test-account/test-gateway",
      );
      expect(init).toEqual({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-aig-authorization": "Bearer test-key",
        },
        body: JSON.stringify(data),
      });
    });

    it("should build universal endpoint request with multiple steps", () => {
      const data = [
        {
          provider: "openai" as const,
          endpoint: "chat/completions",
          headers: { authorization: "Bearer sk-test-1" },
          query: { model: "gpt-4", messages: [] },
        },
        {
          provider: "anthropic" as const,
          endpoint: "v1/messages",
          headers: { authorization: "Bearer sk-test-2" },
          query: { model: "claude-3-opus-20240229", messages: [] },
        },
      ];

      const [url, init] = gateway.buildUniversalEndpointRequest({ data });

      expect(url).toBe(
        "https://gateway.ai.cloudflare.com/v1/test-account/test-gateway",
      );
      expect(init).toEqual({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-aig-authorization": "Bearer test-key",
        },
        body: JSON.stringify(data),
      });
    });

    it("should include custom headers", () => {
      const data = {
        provider: "openai" as const,
        endpoint: "chat/completions",
        headers: { authorization: "Bearer sk-test" },
        query: { model: "gpt-4", messages: [] },
      };

      const [_url, init] = gateway.buildUniversalEndpointRequest({
        data,
        headers: { "cf-aig-metadata": "test-metadata" },
      });

      expect(init.headers).toEqual({
        "Content-Type": "application/json",
        "cf-aig-authorization": "Bearer test-key",
        "cf-aig-metadata": "test-metadata",
      });
    });
  });

  describe("buildProviderEndpointRequest", () => {
    let gateway: CloudflareAIGateway;

    beforeEach(() => {
      gateway = new CloudflareAIGateway(
        "test-account",
        "test-gateway",
        "test-key",
      );
    });

    it("should build provider endpoint request with default method", () => {
      const [url, init] = gateway.buildProviderEndpointRequest({
        provider: "openai",
        path: "chat/completions",
        body: JSON.stringify({ model: "gpt-4", messages: [] }),
      });

      expect(url).toBe(
        "https://gateway.ai.cloudflare.com/v1/test-account/test-gateway/openai/chat/completions",
      );
      expect(init).toEqual({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-aig-authorization": "Bearer test-key",
        },
        body: JSON.stringify({ model: "gpt-4", messages: [] }),
      });
    });

    it("should build provider endpoint request with custom method", () => {
      const [url, init] = gateway.buildProviderEndpointRequest({
        provider: "openai",
        method: "GET",
        path: "models",
        body: null,
      });

      expect(url).toBe(
        "https://gateway.ai.cloudflare.com/v1/test-account/test-gateway/openai/models",
      );
      expect(init).toEqual({
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "cf-aig-authorization": "Bearer test-key",
        },
        body: null,
      });
    });

    it("should normalize path with leading slash", () => {
      const [url] = gateway.buildProviderEndpointRequest({
        provider: "openai",
        path: "/chat/completions",
        body: null,
      });

      expect(url).toBe(
        "https://gateway.ai.cloudflare.com/v1/test-account/test-gateway/openai/chat/completions",
      );
    });

    it("should include custom headers", () => {
      const [_url, init] = gateway.buildProviderEndpointRequest({
        provider: "openai",
        path: "chat/completions",
        body: null,
        headers: { "cf-aig-metadata": "test-metadata" },
      });

      expect(init.headers).toEqual({
        "Content-Type": "application/json",
        "cf-aig-authorization": "Bearer test-key",
        "cf-aig-metadata": "test-metadata",
      });
    });
  });

  describe("buildCompatRequest", () => {
    let gateway: CloudflareAIGateway;

    beforeEach(() => {
      gateway = new CloudflareAIGateway(
        "test-account",
        "test-gateway",
        "test-key",
      );
    });

    it("should build compat request with nested path and merged headers", () => {
      const [url, init] = gateway.buildCompatRequest({
        path: "compat/chat/completions",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "payload",
      });

      expect(url).toBe(
        "https://gateway.ai.cloudflare.com/v1/test-account/test-gateway/compat/chat/completions",
      );

      const headers = new Headers(init.headers);
      expect(headers.get("cf-aig-authorization")).toBe("Bearer test-key");
      expect(headers.get("content-type")).toBe("application/json");
      expect(init.method).toBe("POST");
      expect(init.body).toBe("payload");
    });

    it("should omit body for GET requests while preserving query strings", () => {
      const [_url, init] = gateway.buildCompatRequest({
        path: "/compat/chat/completions?foo=bar",
        method: "GET",
        headers: { Accept: "application/json" },
        body: "ignored",
      });

      const headers = new Headers(init.headers);
      expect(headers.get("cf-aig-authorization")).toBe("Bearer test-key");
      expect(headers.get("accept")).toBe("application/json");
      expect(init.method).toBe("GET");
      expect(init.body).toBeUndefined();
    });
  });

  describe("buildChatCompletionsRequest", () => {
    let gateway: CloudflareAIGateway;

    beforeEach(() => {
      gateway = new CloudflareAIGateway(
        "test-account",
        "test-gateway",
        "test-key",
      );
      vi.mocked(Secrets.getAll).mockReturnValue(["sk-test-1", "sk-test-2"]);
    });

    it("should build chat completions request with multiple API keys", () => {
      const body = JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: "Hello" }],
      });

      const [url, init] = gateway.buildChatCompletionsRequest({
        provider: "openai",
        body,
        headers: { "Custom-Header": "custom-value" },
        apiKeyName: "OPENAI_API_KEY" as keyof Env,
      });

      expect(url).toBe(
        "https://gateway.ai.cloudflare.com/v1/test-account/test-gateway",
      );
      expect(init).toEqual({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-aig-authorization": "Bearer test-key",
          "Custom-Header": "custom-value",
        },
        body: JSON.stringify([
          {
            provider: "compat",
            endpoint: "chat/completions",
            headers: {
              authorization: "Bearer sk-test-1",
              "custom-header": "custom-value",
            },
            query: {
              model: "openai/gpt-4",
              messages: [{ role: "user", content: "Hello" }],
            },
          },
          {
            provider: "compat",
            endpoint: "chat/completions",
            headers: {
              authorization: "Bearer sk-test-2",
              "custom-header": "custom-value",
            },
            query: {
              model: "openai/gpt-4",
              messages: [{ role: "user", content: "Hello" }],
            },
          },
        ]),
      });

      expect(Secrets.getAll).toHaveBeenCalledWith("OPENAI_API_KEY", true);
    });

    it("should handle single API key", () => {
      vi.mocked(Secrets.getAll).mockReturnValue(["sk-test-single"]);

      const body = JSON.stringify({
        model: "claude-3-opus-20240229",
        messages: [{ role: "user", content: "Hello" }],
      });

      const [_url, init] = gateway.buildChatCompletionsRequest({
        provider: "anthropic",
        body,
        headers: {},
        apiKeyName: "ANTHROPIC_API_KEY" as keyof Env,
      });

      const expectedBody = JSON.parse(init.body as string);
      expect(expectedBody).toHaveLength(1);
      expect(expectedBody[0]).toEqual({
        provider: "compat",
        endpoint: "chat/completions",
        headers: {
          authorization: "Bearer sk-test-single",
        },
        query: {
          model: "anthropic/claude-3-opus-20240229",
          messages: [{ role: "user", content: "Hello" }],
        },
      });
    });
  });
});
