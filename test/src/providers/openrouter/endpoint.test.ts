import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenRouterEndpoint } from "~/src/providers/openrouter/endpoint";
import * as Secrets from "~/src/utils/secrets";

vi.mock("~/src/utils/secrets");

describe("OpenRouterEndpoint", () => {
  const mockSecretsGet = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Secrets.Secrets.get).mockImplementation(mockSecretsGet);
  });

  describe("constructor", () => {
    it("should initialize with API key", () => {
      const testApiKey = "test_openrouter_api_key";
      const endpoint = new OpenRouterEndpoint(testApiKey);

      expect(endpoint).toBeInstanceOf(OpenRouterEndpoint);
    });
  });

  describe("available", () => {
    it("should return true when API key is provided", () => {
      const testApiKey = "test_openrouter_api_key";
      const endpoint = new OpenRouterEndpoint(testApiKey);

      expect(endpoint.available()).toBe(true);
    });

    it("should return false when API key is empty", () => {
      const endpoint = new OpenRouterEndpoint("");

      expect(endpoint.available()).toBe(false);
    });

    it("should return false when API key is undefined", () => {
      const endpoint = new OpenRouterEndpoint(undefined as any);

      expect(endpoint.available()).toBe(false);
    });
  });

  describe("headers", () => {
    it("should return headers with Authorization bearer token", () => {
      const testApiKey = "test_openrouter_api_key";
      const endpoint = new OpenRouterEndpoint(testApiKey);

      const headers = endpoint.headers();

      expect(headers).toEqual({
        "Content-Type": "application/json",
        Authorization: `Bearer ${testApiKey}`,
      });
    });

    it("should return headers with empty Authorization when no API key", () => {
      const endpoint = new OpenRouterEndpoint("");

      const headers = endpoint.headers();

      expect(headers).toEqual({
        "Content-Type": "application/json",
        Authorization: "Bearer ",
      });
    });
  });

  describe("baseUrl", () => {
    it("should return OpenRouter API base URL", () => {
      const testApiKey = "test_openrouter_api_key";
      const endpoint = new OpenRouterEndpoint(testApiKey);

      expect(endpoint.baseUrl()).toBe("https://openrouter.ai/api");
    });
  });

  describe("inheritance", () => {
    it("should extend EndpointBase", () => {
      const testApiKey = "test_openrouter_api_key";
      const endpoint = new OpenRouterEndpoint(testApiKey);

      expect(endpoint).toHaveProperty("available");
      expect(endpoint).toHaveProperty("headers");
      expect(endpoint).toHaveProperty("baseUrl");
    });
  });
});
