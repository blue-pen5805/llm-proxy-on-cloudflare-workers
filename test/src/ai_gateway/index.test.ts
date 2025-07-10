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
    // Reset static properties
    CloudflareAIGateway.configure({
      accountId: undefined,
      gatewayId: undefined,
      apiKey: undefined,
    });
  });

  describe("configure", () => {
    it("should configure global settings", () => {
      CloudflareAIGateway.configure({
        accountId: "test-account",
        gatewayId: "test-gateway",
        apiKey: "test-key",
      });

      expect(CloudflareAIGateway.globalAccountId).toBe("test-account");
      expect(CloudflareAIGateway.globalGatewayId).toBe("test-gateway");
      expect(CloudflareAIGateway.globalApiKey).toBe("test-key");
    });

    it("should configure only provided values", () => {
      CloudflareAIGateway.configure({
        accountId: "test-account",
        gatewayId: "test-gateway",
        apiKey: "test-key",
      });

      CloudflareAIGateway.configure({
        gatewayId: "new-gateway",
      });

      expect(CloudflareAIGateway.globalAccountId).toBe("test-account");
      expect(CloudflareAIGateway.globalGatewayId).toBe("new-gateway");
      expect(CloudflareAIGateway.globalApiKey).toBe("test-key");
    });
  });

  describe("isAvailable", () => {
    it("should return true when both accountId and gatewayId are configured", () => {
      CloudflareAIGateway.configure({
        accountId: "test-account",
        gatewayId: "test-gateway",
      });

      expect(CloudflareAIGateway.isAvailable()).toBe(true);
    });

    it("should return false when accountId is missing", () => {
      CloudflareAIGateway.configure({
        gatewayId: "test-gateway",
      });

      expect(CloudflareAIGateway.isAvailable()).toBe(false);
    });

    it("should return false when gatewayId is missing", () => {
      CloudflareAIGateway.configure({
        accountId: "test-account",
      });

      expect(CloudflareAIGateway.isAvailable()).toBe(false);
    });

    it("should return false when both are missing", () => {
      expect(CloudflareAIGateway.isAvailable()).toBe(false);
    });
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

    it("should use global values when not provided", () => {
      CloudflareAIGateway.configure({
        accountId: "global-account",
        gatewayId: "global-gateway",
        apiKey: "global-key",
      });

      const gateway = new CloudflareAIGateway();

      expect(gateway.accountId).toBe("global-account");
      expect(gateway.gatewayId).toBe("global-gateway");
      expect(gateway.apiKey).toBe("global-key");
    });

    it("should prefer instance values over global values", () => {
      CloudflareAIGateway.configure({
        accountId: "global-account",
        gatewayId: "global-gateway",
        apiKey: "global-key",
      });

      const gateway = new CloudflareAIGateway(
        "instance-account",
        "instance-gateway",
        "instance-key",
      );

      expect(gateway.accountId).toBe("instance-account");
      expect(gateway.gatewayId).toBe("instance-gateway");
      expect(gateway.apiKey).toBe("instance-key");
    });

    it("should throw error when required values are missing", () => {
      expect(() => new CloudflareAIGateway()).toThrow(
        "Cloudflare AI Gateway is not configured. Please set accountId, gatewayId.",
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
