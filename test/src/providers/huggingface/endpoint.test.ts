import { describe, it, expect } from "vitest";
import { HuggingFaceEndpoint } from "~/src/providers/huggingface/endpoint";

describe("HuggingFaceEndpoint", () => {
  const testApiKey = "test_huggingface_api_key";

  describe("constructor", () => {
    it("should initialize with API key", () => {
      const endpoint = new HuggingFaceEndpoint(testApiKey);
      expect(endpoint.apiKey).toBe(testApiKey);
    });
  });

  describe("available", () => {
    it("should return true when API key is provided", () => {
      const endpoint = new HuggingFaceEndpoint(testApiKey);
      expect(endpoint.available()).toBe(true);
    });

    it("should return false when API key is empty", () => {
      const endpoint = new HuggingFaceEndpoint("");
      expect(endpoint.available()).toBe(false);
    });

    it("should return false when API key is null", () => {
      const endpoint = new HuggingFaceEndpoint(null as any);
      expect(endpoint.available()).toBe(false);
    });

    it("should return false when API key is undefined", () => {
      const endpoint = new HuggingFaceEndpoint(undefined as any);
      expect(endpoint.available()).toBe(false);
    });
  });

  describe("baseUrl", () => {
    it("should return correct HuggingFace API base URL", () => {
      const endpoint = new HuggingFaceEndpoint(testApiKey);
      expect(endpoint.baseUrl()).toBe(
        "https://api-inference.huggingface.co/v1",
      );
    });
  });

  describe("headers", () => {
    it("should return correct headers with authorization", () => {
      const endpoint = new HuggingFaceEndpoint(testApiKey);
      const headers = endpoint.headers();

      expect(headers).toEqual({
        "Content-Type": "application/json",
        Authorization: `Bearer ${testApiKey}`,
      });
    });
  });

  describe("inheritance", () => {
    it("should extend EndpointBase", () => {
      const endpoint = new HuggingFaceEndpoint(testApiKey);
      expect(endpoint).toHaveProperty("available");
      expect(endpoint).toHaveProperty("baseUrl");
      expect(endpoint).toHaveProperty("headers");
    });
  });
});
