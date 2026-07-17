import { describe, it, expect, vi, beforeEach } from "vitest";
import { CloudflareAIGateway } from "~/src/ai_gateway";

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
        true,
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

    it("omits authorization when no gateway token is configured", () => {
      expect(
        new CloudflareAIGateway("account", "gateway").buildHeaders(),
      ).toEqual({
        "Content-Type": "application/json",
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
      const [url, init] = gateway.buildProviderEndpointRequest({
        provider: "openai",
        path: "/chat/completions",
      });

      expect(url).toBe(
        "https://gateway.ai.cloudflare.com/v1/test-account/test-gateway/openai/chat/completions",
      );
      expect(init.body).toBeNull();
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

    it("preserves an AbortSignal", () => {
      const controller = new AbortController();
      const [_url, init] = gateway.buildCompatRequest({
        path: "/compat/models",
        method: "HEAD",
        body: "ignored",
        signal: controller.signal,
      });

      expect(init.body).toBeUndefined();
      expect(init.signal).toBe(controller.signal);
    });
  });

  describe("buildCompatibilityEndpointRequest", () => {
    it("builds a JSON request to the compatibility endpoint", () => {
      const gateway = new CloudflareAIGateway(
        "test-account",
        "test-gateway",
        "test-key",
      );
      const query = { model: "openai/gpt-4", messages: [] };

      const [url, init] = gateway.buildCompatibilityEndpointRequest({
        query,
        headers: { authorization: "Bearer sk-test" },
      });

      expect(url).toBe(
        "https://gateway.ai.cloudflare.com/v1/test-account/test-gateway/compat/chat/completions",
      );
      expect(new Headers(init.headers).get("authorization")).toBe(
        "Bearer sk-test",
      );
      expect(new Headers(init.headers).get("cf-aig-authorization")).toBe(
        "Bearer test-key",
      );
      expect(init.body).toBe(JSON.stringify(query));
    });

    it("normalizes a custom endpoint", () => {
      const gateway = new CloudflareAIGateway("account", "gateway");
      const [url] = gateway.buildCompatibilityEndpointRequest({
        endpoint: "/embeddings",
        query: { model: "openai/text-embedding-3-small", input: "hello" },
      });

      expect(url).toBe(
        "https://gateway.ai.cloudflare.com/v1/account/gateway/compat/embeddings",
      );
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
    });

    it("should build chat completions request with multiple API keys", () => {
      const body = JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: "Hello" }],
      });

      const requests = gateway.buildChatCompletionsRequests({
        provider: "openai",
        body,
        headers: { "Custom-Header": "custom-value" },
        apiKeys: ["sk-test-1", "sk-test-2"],
      });

      expect(requests).toHaveLength(2);
      for (const [index, [url, init]] of requests.entries()) {
        expect(url).toBe(
          "https://gateway.ai.cloudflare.com/v1/test-account/test-gateway/compat/chat/completions",
        );
        const requestHeaders = new Headers(init.headers);
        expect(requestHeaders.get("authorization")).toBe(
          `Bearer sk-test-${index + 1}`,
        );
        expect(requestHeaders.get("cf-aig-authorization")).toBe(
          "Bearer test-key",
        );
        expect(requestHeaders.get("custom-header")).toBe("custom-value");
        expect(JSON.parse(init.body as string)).toEqual({
          model: "openai/gpt-4",
          messages: [{ role: "user", content: "Hello" }],
        });
      }
    });

    it("should handle single API key", () => {
      const body = JSON.stringify({
        model: "claude-3-opus-20240229",
        messages: [{ role: "user", content: "Hello" }],
      });

      const [[, init]] = gateway.buildChatCompletionsRequests({
        provider: "anthropic",
        body,
        headers: {},
        apiKeys: ["sk-test-single"],
      });

      const expectedBody = JSON.parse(init.body as string);
      expect(new Headers(init.headers).get("authorization")).toBe(
        "Bearer sk-test-single",
      );
      expect(expectedBody).toEqual({
        model: "anthropic/claude-3-opus-20240229",
        messages: [{ role: "user", content: "Hello" }],
      });
    });

    it("builds one BYOK request when no provider key is configured", () => {
      const requests = gateway.buildChatCompletionsRequests({
        provider: "aws-bedrock",
        body: JSON.stringify({ model: "model-id", messages: [] }),
        headers: { Authorization: "Bearer proxy-credential" },
      });

      expect(requests).toHaveLength(1);
      const [, init] = requests[0];
      expect(new Headers(init.headers).has("authorization")).toBe(false);
      expect(new Headers(init.headers).get("cf-aig-authorization")).toBe(
        "Bearer test-key",
      );
      expect(JSON.parse(init.body as string).model).toBe(
        "aws-bedrock/model-id",
      );
    });

    it("builds a Vertex request with a Base64 service-account credential", () => {
      const requests = gateway.buildChatCompletionsRequests({
        provider: "google-vertex-ai",
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [],
        }),
        headers: {},
        apiKeys: ["base64-service-account"],
      });

      expect(requests).toHaveLength(1);
      const [, init] = requests[0];
      expect(new Headers(init.headers).get("authorization")).toBe(
        "Bearer base64-service-account",
      );
      expect(JSON.parse(init.body as string).model).toBe(
        "google-vertex-ai/google/gemini-2.5-flash",
      );
    });

    it("uses a pre-parsed body without parsing the serialized fallback", () => {
      const [[, init]] = gateway.buildChatCompletionsRequests({
        provider: "openai",
        body: "not valid JSON",
        parsedBody: { model: "gpt-4o", messages: [] },
        headers: {},
        apiKeys: ["sk-test"],
      });

      expect(JSON.parse(init.body as string)).toEqual({
        model: "openai/gpt-4o",
        messages: [],
      });
    });
  });
});
