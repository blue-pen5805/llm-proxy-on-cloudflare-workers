import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AiGatewayBasicEndpointPaths,
  AiGatewayEndpoint,
  AiGatewaySupportedProviders,
  OpenAICompatibleProviders,
} from "~/src/providers/ai_gateway";
import { EndpointBase } from "~/src/providers/endpoint";

vi.mock("~/src/utils", () => ({
  fetch2: vi.fn().mockImplementation(() => Promise.resolve(new Response())),
}));

describe("AI Gateway", () => {
  afterEach(() => {
    vi.clearAllMocks();

    // Reset configurations between tests
    AiGatewayEndpoint.accountId = undefined;
    AiGatewayEndpoint.gatewayId = undefined;
    AiGatewayEndpoint.apiKey = undefined;
  });

  describe("AiGatewaySupportedProviders", () => {
    it("should contain the expected providers", () => {
      // A few important providers that should be present
      expect(AiGatewaySupportedProviders).toContain("openai");
      expect(AiGatewaySupportedProviders).toContain("anthropic");
      expect(AiGatewaySupportedProviders).toContain("google-ai-studio");
    });
  });

  describe("OpenAICompatibleProviders", () => {
    it("should be a subset of supported providers", () => {
      OpenAICompatibleProviders.forEach((provider) => {
        expect(AiGatewaySupportedProviders).toContain(provider);
      });
    });

    it("should contain key OpenAI-compatible providers", () => {
      expect(OpenAICompatibleProviders).toContain("openai");
      expect(OpenAICompatibleProviders).toContain("mistral");
      expect(OpenAICompatibleProviders).toContain("groq");
    });
  });

  describe("configure", () => {
    it("should set static configuration properties", () => {
      AiGatewayEndpoint.configure(
        "test-account",
        "test-gateway",
        "test-api-key",
      );

      expect(AiGatewayEndpoint.accountId).toBe("test-account");
      expect(AiGatewayEndpoint.gatewayId).toBe("test-gateway");
      expect(AiGatewayEndpoint.apiKey).toBe("test-api-key");
    });
  });

  describe("isActive", () => {
    it("should return true when accountId and gatewayId are set", () => {
      AiGatewayEndpoint.accountId = "test-account";
      AiGatewayEndpoint.gatewayId = "test-gateway";

      expect(AiGatewayEndpoint.isActive()).toBe(true);
    });

    it("should return false when accountId is missing", () => {
      AiGatewayEndpoint.accountId = undefined;
      AiGatewayEndpoint.gatewayId = "test-gateway";

      expect(AiGatewayEndpoint.isActive()).toBe(false);
    });

    it("should return false when gatewayId is missing", () => {
      AiGatewayEndpoint.accountId = "test-account";
      AiGatewayEndpoint.gatewayId = undefined;

      expect(AiGatewayEndpoint.isActive()).toBe(false);
    });

    it("should return true for supported provider", () => {
      AiGatewayEndpoint.accountId = "test-account";
      AiGatewayEndpoint.gatewayId = "test-gateway";

      expect(AiGatewayEndpoint.isActive("openai")).toBe(true);
    });

    it("should return false for unsupported provider", () => {
      AiGatewayEndpoint.accountId = "test-account";
      AiGatewayEndpoint.gatewayId = "test-gateway";

      expect(AiGatewayEndpoint.isActive("unsupported-provider")).toBe(false);
    });
  });

  describe("AiGatewayEndpoint class", () => {
    let mockDestinationEndpoint: EndpointBase;

    beforeEach(() => {
      mockDestinationEndpoint = {
        available: vi.fn().mockReturnValue(true),
        baseUrl: vi.fn().mockReturnValue("https://api.destination.com"),
        pathnamePrefix: vi.fn().mockReturnValue("/prefix"),
        headers: vi.fn().mockReturnValue({ "Dest-Header": "value" }),
        fetch: vi.fn(),
        requestData: vi.fn(),
      } as unknown as EndpointBase;

      AiGatewayEndpoint.configure(
        "test-account",
        "test-gateway",
        "test-api-key",
      );
    });

    describe("constructor", () => {
      it("should initialize with provider and destination", () => {
        const endpoint = new AiGatewayEndpoint(
          "openai",
          mockDestinationEndpoint,
        );

        expect(endpoint.providerName).toBe("openai");
        expect(endpoint.destination).toBe(mockDestinationEndpoint);
      });

      it("should initialize with defaults", () => {
        const defaultEndpoint = new AiGatewayEndpoint();

        expect(defaultEndpoint.providerName).toBeUndefined();
        expect(defaultEndpoint.destination).toBeUndefined();
      });
    });

    describe("available", () => {
      it("should return true if destination is available", () => {
        const endpoint = new AiGatewayEndpoint(
          undefined,
          mockDestinationEndpoint,
        );

        expect(endpoint.available()).toBe(true);
        expect(mockDestinationEndpoint.available).toHaveBeenCalled();
      });

      it("should return true if destination and AI Gateway is active", () => {
        const endpoint = new AiGatewayEndpoint(
          "openai",
          mockDestinationEndpoint,
        );

        expect(endpoint.available()).toBe(true);
      });

      it("should return false if no destination and AI Gateway is not active", () => {
        AiGatewayEndpoint.accountId = undefined;
        AiGatewayEndpoint.gatewayId = undefined;
        const endpoint = new AiGatewayEndpoint(
          undefined,
          mockDestinationEndpoint,
        );

        expect(endpoint.available()).toBe(false);
      });
    });

    describe("baseUrl", () => {
      it("should return correct gateway URL with provider", () => {
        const endpoint = new AiGatewayEndpoint(
          "openai",
          mockDestinationEndpoint,
        );

        expect(endpoint.baseUrl()).toBe(
          "https://gateway.ai.cloudflare.com/v1/test-account/test-gateway/openai",
        );
      });

      it("should return gateway URL without provider", () => {
        const endpoint = new AiGatewayEndpoint();

        expect(endpoint.baseUrl()).toBe(
          "https://gateway.ai.cloudflare.com/v1/test-account/test-gateway",
        );
      });
    });

    describe("pathnamePrefix", () => {
      it("should return destination pathnamePrefix if available", () => {
        const endpoint = new AiGatewayEndpoint(
          undefined,
          mockDestinationEndpoint,
        );

        expect(endpoint.pathnamePrefix()).toBe("/prefix");
        expect(mockDestinationEndpoint.pathnamePrefix).toHaveBeenCalled();
      });

      it("should return empty string if no destination", () => {
        const gatewayEndpoint = new AiGatewayEndpoint("openai");
        expect(gatewayEndpoint.pathnamePrefix()).toBe("");
      });
    });

    describe("AiGatewayBasicEndpointPaths", () => {
      it("should have matching entries for OpenAI-compatible providers", () => {
        OpenAICompatibleProviders.forEach((provider) => {
          if (AiGatewayBasicEndpointPaths[provider]) {
            expect(
              AiGatewayBasicEndpointPaths[provider].includes(
                "chat/completions",
              ),
            ).toBeTruthy();
          }
        });
      });
    });

    describe("headers", () => {
      it("should prioritize destination Content-Type if provided", () => {
        const customDestination = {
          headers: vi.fn().mockReturnValue({
            "Content-Type": "application/custom-format",
            "Custom-Header": "custom-value",
          }),
          available: vi.fn().mockReturnValue(true),
          baseUrl: vi.fn(),
          pathnamePrefix: vi.fn(),
          fetch: vi.fn(),
          requestData: vi.fn(),
        } as unknown as EndpointBase;

        const endpoint = new AiGatewayEndpoint(undefined, customDestination);
        const headers = endpoint.headers();

        expect(headers).toHaveProperty(
          "Content-Type",
          "application/custom-format",
        );
        expect(headers).toHaveProperty("Custom-Header", "custom-value");
      });

      it("should handle empty destination headers", () => {
        const emptyHeadersDestination = {
          headers: vi.fn().mockReturnValue({}),
          available: vi.fn().mockReturnValue(true),
          baseUrl: vi.fn(),
          pathnamePrefix: vi.fn(),
          fetch: vi.fn(),
          requestData: vi.fn(),
        } as unknown as EndpointBase;

        const endpoint = new AiGatewayEndpoint(
          undefined,
          emptyHeadersDestination,
        );
        const headers = endpoint.headers();

        expect(headers).toHaveProperty("Content-Type", "application/json");
        expect(headers).toHaveProperty(
          "cf-aig-authorization",
          "Bearer test-api-key",
        );
      });
    });

    describe("availability edge cases", () => {
      beforeEach(() => {
        AiGatewayEndpoint.accountId = "test-account";
        AiGatewayEndpoint.gatewayId = "test-gateway";
      });

      it("should return false if gateway is active but destination is not available", () => {
        const unavailableDestination = {
          available: vi.fn().mockReturnValue(false),
          headers: vi.fn(),
          baseUrl: vi.fn(),
          pathnamePrefix: vi.fn(),
          fetch: vi.fn(),
          requestData: vi.fn(),
        } as unknown as EndpointBase;

        const endpoint = new AiGatewayEndpoint(
          "openai",
          unavailableDestination,
        );
        expect(endpoint.available()).toBe(false);
      });

      it("should return false if provider is unsupported", () => {
        const endpoint = new AiGatewayEndpoint(
          "unsupported-provider",
          mockDestinationEndpoint,
        );
        expect(endpoint.available()).toBe(false);
      });

      it("should return false if no destination is provided", () => {
        const endpoint = new AiGatewayEndpoint("openai");
        expect(endpoint.available()).toBe(false);
      });
    });
  });
});
