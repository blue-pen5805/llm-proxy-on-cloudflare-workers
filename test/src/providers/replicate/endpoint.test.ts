import { describe, it, expect } from "vitest";
import { ReplicateEndpoint } from "~/src/providers/replicate/endpoint";

describe("ReplicateEndpoint", () => {
  const testApiKey = "test_replicate_api_key";

  describe("constructor", () => {
    it("should initialize with API key", () => {
      const endpoint = new ReplicateEndpoint(testApiKey);
      expect(endpoint.apiKey).toBe(testApiKey);
    });
  });

  describe("available", () => {
    it("should return true when API key is provided", () => {
      const endpoint = new ReplicateEndpoint(testApiKey);
      expect(endpoint.available()).toBe(true);
    });

    it("should return false when API key is empty", () => {
      const endpoint = new ReplicateEndpoint("");
      expect(endpoint.available()).toBe(false);
    });

    it("should return false when API key is null", () => {
      const endpoint = new ReplicateEndpoint(null as any);
      expect(endpoint.available()).toBe(false);
    });

    it("should return false when API key is undefined", () => {
      const endpoint = new ReplicateEndpoint(undefined as any);
      expect(endpoint.available()).toBe(false);
    });
  });

  describe("baseUrl", () => {
    it("should return correct Replicate API base URL", () => {
      const endpoint = new ReplicateEndpoint(testApiKey);
      expect(endpoint.baseUrl()).toBe("https://api.replicate.com/v1");
    });
  });

  describe("headers", () => {
    it("should return correct headers with Token authorization", () => {
      const endpoint = new ReplicateEndpoint(testApiKey);
      const headers = endpoint.headers();

      expect(headers).toEqual({
        "Content-Type": "application/json",
        Authorization: `Token ${testApiKey}`,
      });
    });
  });

  describe("inheritance", () => {
    it("should extend EndpointBase", () => {
      const endpoint = new ReplicateEndpoint(testApiKey);
      expect(endpoint).toHaveProperty("available");
      expect(endpoint).toHaveProperty("baseUrl");
      expect(endpoint).toHaveProperty("headers");
    });
  });
});
