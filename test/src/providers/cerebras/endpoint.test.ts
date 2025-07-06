import { describe, it, expect } from "vitest";
import { CerebrasEndpoint } from "~/src/providers/cerebras/endpoint";

describe("CerebrasEndpoint", () => {
  const testApiKey = "test_cerebras_api_key";

  describe("constructor", () => {
    it("should initialize with API key", () => {
      const endpoint = new CerebrasEndpoint(testApiKey);
      expect(endpoint.apiKey).toBe(testApiKey);
    });
  });

  describe("available", () => {
    it("should return true when API key is provided", () => {
      const endpoint = new CerebrasEndpoint(testApiKey);
      expect(endpoint.available()).toBe(true);
    });

    it("should return false when API key is empty", () => {
      const endpoint = new CerebrasEndpoint("");
      expect(endpoint.available()).toBe(false);
    });

    it("should return false when API key is null", () => {
      const endpoint = new CerebrasEndpoint(null as any);
      expect(endpoint.available()).toBe(false);
    });

    it("should return false when API key is undefined", () => {
      const endpoint = new CerebrasEndpoint(undefined as any);
      expect(endpoint.available()).toBe(false);
    });
  });

  describe("baseUrl", () => {
    it("should return correct Cerebras API base URL", () => {
      const endpoint = new CerebrasEndpoint(testApiKey);
      expect(endpoint.baseUrl()).toBe("https://api.cerebras.ai/v1");
    });
  });

  describe("headers", () => {
    it("should return correct headers with authorization", () => {
      const endpoint = new CerebrasEndpoint(testApiKey);
      const headers = endpoint.headers();

      expect(headers).toEqual({
        "Content-Type": "application/json",
        Authorization: `Bearer ${testApiKey}`,
      });
    });
  });

  describe("inheritance", () => {
    it("should extend EndpointBase", () => {
      const endpoint = new CerebrasEndpoint(testApiKey);
      expect(endpoint).toHaveProperty("available");
      expect(endpoint).toHaveProperty("baseUrl");
      expect(endpoint).toHaveProperty("headers");
    });
  });
});
