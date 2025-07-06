import { describe, it, expect } from "vitest";
import { OpenAIEndpoint } from "~/src/providers/openai/endpoint";

describe("OpenAIEndpoint", () => {
  describe("constructor", () => {
    it("should initialize with API key", () => {
      const apiKey = "sk-test-api-key";
      const endpoint = new OpenAIEndpoint(apiKey);

      expect(endpoint.apiKey).toBe(apiKey);
    });

    it("should initialize with undefined API key", () => {
      const endpoint = new OpenAIEndpoint(undefined as any);

      expect(endpoint.apiKey).toBeUndefined();
    });
  });

  describe("available", () => {
    it("should return true when API key is provided", () => {
      const endpoint = new OpenAIEndpoint("sk-test-api-key");

      expect(endpoint.available()).toBe(true);
    });

    it("should return false when API key is empty string", () => {
      const endpoint = new OpenAIEndpoint("");

      expect(endpoint.available()).toBe(false);
    });

    it("should return false when API key is undefined", () => {
      const endpoint = new OpenAIEndpoint(undefined as any);

      expect(endpoint.available()).toBe(false);
    });

    it("should return false when API key is null", () => {
      const endpoint = new OpenAIEndpoint(null as any);

      expect(endpoint.available()).toBe(false);
    });
  });

  describe("baseUrl", () => {
    it("should return OpenAI API base URL", () => {
      const endpoint = new OpenAIEndpoint("test-key");

      expect(endpoint.baseUrl()).toBe("https://api.openai.com/v1");
    });
  });

  describe("headers", () => {
    it("should return headers with Authorization bearer token", () => {
      const apiKey = "sk-test-api-key";
      const endpoint = new OpenAIEndpoint(apiKey);

      const headers = endpoint.headers();

      expect(headers).toEqual({
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      });
    });

    it("should handle undefined API key in headers", () => {
      const endpoint = new OpenAIEndpoint(undefined as any);

      const headers = endpoint.headers();

      expect(headers).toEqual({
        "Content-Type": "application/json",
        Authorization: "Bearer undefined",
      });
    });
  });

  describe("inheritance", () => {
    it("should extend EndpointBase", () => {
      const endpoint = new OpenAIEndpoint("test-key");

      expect(endpoint).toHaveProperty("pathnamePrefix");
      expect(endpoint).toHaveProperty("requestData");
      expect(endpoint).toHaveProperty("fetch");
    });
  });
});
