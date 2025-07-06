import { describe, it, expect } from "vitest";
import { PerplexityAiEndpoint } from "~/src/providers/perplexity-ai/endpoint";

describe("PerplexityAiEndpoint", () => {
  const testApiKey = "test_perplexity_api_key";

  describe("constructor", () => {
    it("should initialize with API key", () => {
      const endpoint = new PerplexityAiEndpoint(testApiKey);
      expect(endpoint.apiKey).toBe(testApiKey);
    });
  });

  describe("available", () => {
    it("should return true when API key is provided", () => {
      const endpoint = new PerplexityAiEndpoint(testApiKey);
      expect(endpoint.available()).toBe(true);
    });

    it("should return false when API key is empty", () => {
      const endpoint = new PerplexityAiEndpoint("");
      expect(endpoint.available()).toBe(false);
    });

    it("should return false when API key is null", () => {
      const endpoint = new PerplexityAiEndpoint(null as any);
      expect(endpoint.available()).toBe(false);
    });

    it("should return false when API key is undefined", () => {
      const endpoint = new PerplexityAiEndpoint(undefined as any);
      expect(endpoint.available()).toBe(false);
    });
  });

  describe("baseUrl", () => {
    it("should return correct Perplexity AI API base URL", () => {
      const endpoint = new PerplexityAiEndpoint(testApiKey);
      expect(endpoint.baseUrl()).toBe("https://api.perplexity.ai");
    });
  });

  describe("headers", () => {
    it("should return correct headers with authorization and accept", () => {
      const endpoint = new PerplexityAiEndpoint(testApiKey);
      const headers = endpoint.headers();

      expect(headers).toEqual({
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${testApiKey}`,
      });
    });
  });

  describe("inheritance", () => {
    it("should extend EndpointBase", () => {
      const endpoint = new PerplexityAiEndpoint(testApiKey);
      expect(endpoint).toHaveProperty("available");
      expect(endpoint).toHaveProperty("baseUrl");
      expect(endpoint).toHaveProperty("headers");
    });
  });
});
