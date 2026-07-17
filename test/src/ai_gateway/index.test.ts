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
      const gateway = new CloudflareAIGateway(
        "account",
        "gateway",
        "key",
        "rest-key",
      );

      expect(gateway.accountId).toBe("account");
      expect(gateway.gatewayId).toBe("gateway");
      expect(gateway.apiKey).toBe("key");
      expect(gateway.restApiToken).toBe("rest-key");
    });

    it("should throw error when accountId is missing", () => {
      expect(() => new CloudflareAIGateway("", "gateway")).toThrow(
        "Cloudflare AI Gateway accountId or gatewayId is invalid.",
      );
    });

    it("should throw error when gatewayId is missing", () => {
      expect(() => new CloudflareAIGateway("account", "")).toThrow(
        "Cloudflare AI Gateway accountId or gatewayId is invalid.",
      );
    });

    it("rejects path separators in account and gateway identifiers", () => {
      expect(() => new CloudflareAIGateway("../account", "gateway")).toThrow();
      expect(() => new CloudflareAIGateway("account", "../gateway")).toThrow();
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
      const headers = new Headers(gateway.buildHeaders());

      expect(headers.get("content-type")).toBe("application/json");
      expect(headers.get("cf-aig-authorization")).toBe("Bearer test-key");
    });

    it("should merge additional headers", () => {
      const headers = new Headers(
        gateway.buildHeaders({
          "Custom-Header": "custom-value",
          "Another-Header": "another-value",
        }),
      );

      expect(headers.get("content-type")).toBe("application/json");
      expect(headers.get("cf-aig-authorization")).toBe("Bearer test-key");
      expect(headers.get("custom-header")).toBe("custom-value");
      expect(headers.get("another-header")).toBe("another-value");
    });

    it("should override default headers with additional headers", () => {
      const headers = new Headers(
        gateway.buildHeaders({
          "Content-Type": "text/plain",
        }),
      );

      expect(headers.get("content-type")).toBe("text/plain");
      expect(headers.get("cf-aig-authorization")).toBe("Bearer test-key");
    });

    it("does not allow additional headers to replace the Gateway token", () => {
      const headers = gateway.buildHeaders({
        "cf-aig-authorization": "Bearer attacker-token",
      });

      expect(new Headers(headers).get("cf-aig-authorization")).toBe(
        "Bearer test-key",
      );
    });

    it("omits authorization when no gateway token is configured", () => {
      const headers = new Headers(
        new CloudflareAIGateway("account", "gateway").buildHeaders(),
      );
      expect(headers.get("content-type")).toBe("application/json");
      expect(headers.has("cf-aig-authorization")).toBe(false);
    });

    it("preserves Headers instances without dropping their entries", () => {
      const headers = new Headers(
        gateway.buildHeaders(
          new Headers({
            Authorization: "Bearer provider-key",
            "cf-aig-metadata": '{"tenant":"example"}',
          }),
        ),
      );

      expect(headers.get("authorization")).toBe("Bearer provider-key");
      expect(headers.get("cf-aig-metadata")).toBe('{"tenant":"example"}');
      expect(headers.get("cf-aig-authorization")).toBe("Bearer test-key");
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
      expect(init.method).toBe("POST");
      expect(init.body).toBe(JSON.stringify(data));
      expect(new Headers(init.headers).get("content-type")).toBe(
        "application/json",
      );
      expect(new Headers(init.headers).get("cf-aig-authorization")).toBe(
        "Bearer test-key",
      );
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
      expect(init.method).toBe("POST");
      expect(init.body).toBe(JSON.stringify(data));
      expect(new Headers(init.headers).get("content-type")).toBe(
        "application/json",
      );
      expect(new Headers(init.headers).get("cf-aig-authorization")).toBe(
        "Bearer test-key",
      );
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

      const headers = new Headers(init.headers);
      expect(headers.get("content-type")).toBe("application/json");
      expect(headers.get("cf-aig-authorization")).toBe("Bearer test-key");
      expect(headers.get("cf-aig-metadata")).toBe("test-metadata");
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
      expect(init.method).toBe("POST");
      expect(init.body).toBe(JSON.stringify({ model: "gpt-4", messages: [] }));
      expect(new Headers(init.headers).get("content-type")).toBe(
        "application/json",
      );
      expect(new Headers(init.headers).get("cf-aig-authorization")).toBe(
        "Bearer test-key",
      );
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
      expect(init.method).toBe("GET");
      expect(init.body).toBeNull();
      expect(new Headers(init.headers).get("content-type")).toBe(
        "application/json",
      );
      expect(new Headers(init.headers).get("cf-aig-authorization")).toBe(
        "Bearer test-key",
      );
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

      const headers = new Headers(init.headers);
      expect(headers.get("content-type")).toBe("application/json");
      expect(headers.get("cf-aig-authorization")).toBe("Bearer test-key");
      expect(headers.get("cf-aig-metadata")).toBe("test-metadata");
    });
  });

  describe("buildCompatibilityEndpointRequest", () => {
    it("builds a request to the fixed chat completions endpoint", () => {
      const gateway = new CloudflareAIGateway(
        "test-account",
        "test-gateway",
        "test-key",
      );
      const body = JSON.stringify({ model: "openai/gpt-4", messages: [] });
      const controller = new AbortController();

      const [url, init] = gateway.buildCompatibilityEndpointRequest({
        body,
        headers: { authorization: "Bearer sk-test" },
        signal: controller.signal,
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
      expect(init.method).toBe("POST");
      expect(init.body).toBe(body);
      expect(init.signal).toBe(controller.signal);
    });

    it("omits optional body and signal when they are not supplied", () => {
      const gateway = new CloudflareAIGateway("account", "gateway");
      const [, init] = gateway.buildCompatibilityEndpointRequest({});

      expect(init.body).toBeUndefined();
      expect(init.signal).toBeUndefined();
      expect(new Headers(init.headers).get("content-type")).toBe(
        "application/json",
      );
    });
  });

  describe("buildRestApiRequest", () => {
    it.each([
      "/ai/run",
      "/ai/v1/chat/completions",
      "/ai/v1/responses",
      "/ai/v1/messages",
    ] as const)("builds POST %s with REST authentication", (path) => {
      const gateway = new CloudflareAIGateway(
        "test-account",
        "test-gateway",
        "legacy-token",
        "rest-token",
      );
      const controller = new AbortController();
      const [url, init] = gateway.buildRestApiRequest({
        path,
        headers: {
          Authorization: "Bearer client-token",
          "cf-aig-gateway-id": "client-gateway",
          "cf-aig-metadata": '{"user":"123"}',
        },
        body: "payload",
        signal: controller.signal,
      });

      expect(url).toBe(
        `https://api.cloudflare.com/client/v4/accounts/test-account${path}`,
      );
      const headers = new Headers(init.headers);
      expect(headers.get("authorization")).toBe("Bearer rest-token");
      expect(headers.get("cf-aig-gateway-id")).toBe("test-gateway");
      expect(headers.get("cf-aig-metadata")).toBe('{"user":"123"}');
      expect(headers.get("content-type")).toBe("application/json");
      expect(init.method).toBe("POST");
      expect(init.body).toBe("payload");
      expect(init.signal).toBe(controller.signal);
    });

    it("preserves an explicit content type", () => {
      const gateway = new CloudflareAIGateway(
        "account",
        "gateway",
        undefined,
        "rest-token",
      );
      const [, init] = gateway.buildRestApiRequest({
        path: "/ai/run",
        headers: { "Content-Type": "application/custom+json" },
      });

      expect(new Headers(init.headers).get("content-type")).toBe(
        "application/custom+json",
      );
      expect(init.body).toBeUndefined();
    });

    it("rejects requests without a REST API token", () => {
      const gateway = new CloudflareAIGateway("account", "gateway");

      expect(() => gateway.buildRestApiRequest({ path: "/ai/run" })).toThrow(
        "AI Gateway REST API requires CLOUDFLARE_API_TOKEN.",
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
