import { describe, it, expect } from "vitest";
import { GroqEndpoint } from "~/src/providers/groq/endpoint";

describe("GroqEndpoint", () => {
  describe("constructor", () => {
    it("should initialize with API key", () => {
      const apiKey = "gsk_test_api_key";
      const endpoint = new GroqEndpoint(apiKey);

      expect(endpoint.apiKey).toBe(apiKey);
    });

    it("should initialize with undefined API key", () => {
      const endpoint = new GroqEndpoint(undefined as any);

      expect(endpoint.apiKey).toBeUndefined();
    });
  });

  describe("available", () => {
    it("should return true when API key is provided", () => {
      const endpoint = new GroqEndpoint("gsk_test_api_key");

      expect(endpoint.available()).toBe(true);
    });

    it("should return false when API key is empty string", () => {
      const endpoint = new GroqEndpoint("");

      expect(endpoint.available()).toBe(false);
    });

    it("should return false when API key is undefined", () => {
      const endpoint = new GroqEndpoint(undefined as any);

      expect(endpoint.available()).toBe(false);
    });

    it("should return false when API key is null", () => {
      const endpoint = new GroqEndpoint(null as any);

      expect(endpoint.available()).toBe(false);
    });
  });

  describe("baseUrl", () => {
    it("should return Groq API base URL", () => {
      const endpoint = new GroqEndpoint("test-key");

      expect(endpoint.baseUrl()).toBe("https://api.groq.com/openai/v1");
    });
  });

  describe("headers", () => {
    it("should return headers with Authorization bearer token", () => {
      const apiKey = "gsk_test_api_key";
      const endpoint = new GroqEndpoint(apiKey);

      const headers = endpoint.headers();

      expect(headers).toEqual({
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      });
    });

    it("should handle undefined API key in headers", () => {
      const endpoint = new GroqEndpoint(undefined as any);

      const headers = endpoint.headers();

      expect(headers).toEqual({
        "Content-Type": "application/json",
        Authorization: "Bearer undefined",
      });
    });
  });

  describe("inheritance", () => {
    it("should extend EndpointBase", () => {
      const endpoint = new GroqEndpoint("test-key");

      expect(endpoint).toHaveProperty("pathnamePrefix");
      expect(endpoint).toHaveProperty("requestData");
      expect(endpoint).toHaveProperty("fetch");
    });
  });
});
