import { describe, it, expect } from "vitest";
import { AnthropicEndpoint } from "~/src/providers/anthropic/endpoint";

describe("AnthropicEndpoint", () => {
  describe("constructor", () => {
    it("should initialize with API key", () => {
      const apiKey = "sk-ant-test-api-key";
      const endpoint = new AnthropicEndpoint(apiKey);

      expect(endpoint.apiKey).toBe(apiKey);
    });

    it("should initialize with undefined API key", () => {
      const endpoint = new AnthropicEndpoint(undefined as any);

      expect(endpoint.apiKey).toBeUndefined();
    });
  });

  describe("available", () => {
    it("should return true when API key is provided", () => {
      const endpoint = new AnthropicEndpoint("sk-ant-test-api-key");

      expect(endpoint.available()).toBe(true);
    });

    it("should return false when API key is empty string", () => {
      const endpoint = new AnthropicEndpoint("");

      expect(endpoint.available()).toBe(false);
    });

    it("should return false when API key is undefined", () => {
      const endpoint = new AnthropicEndpoint(undefined as any);

      expect(endpoint.available()).toBe(false);
    });

    it("should return false when API key is null", () => {
      const endpoint = new AnthropicEndpoint(null as any);

      expect(endpoint.available()).toBe(false);
    });
  });

  describe("baseUrl", () => {
    it("should return Anthropic API base URL", () => {
      const endpoint = new AnthropicEndpoint("test-key");

      expect(endpoint.baseUrl()).toBe("https://api.anthropic.com");
    });
  });

  describe("headers", () => {
    it("should return headers with x-api-key and anthropic-version", () => {
      const apiKey = "sk-ant-test-api-key";
      const endpoint = new AnthropicEndpoint(apiKey);

      const headers = endpoint.headers();

      expect(headers).toEqual({
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      });
    });

    it("should handle undefined API key in headers", () => {
      const endpoint = new AnthropicEndpoint(undefined as any);

      const headers = endpoint.headers();

      expect(headers).toEqual({
        "Content-Type": "application/json",
        "x-api-key": "undefined",
        "anthropic-version": "2023-06-01",
      });
    });
  });

  describe("inheritance", () => {
    it("should extend EndpointBase", () => {
      const endpoint = new AnthropicEndpoint("test-key");

      expect(endpoint).toHaveProperty("pathnamePrefix");
      expect(endpoint).toHaveProperty("requestData");
      expect(endpoint).toHaveProperty("fetch");
    });
  });
});
