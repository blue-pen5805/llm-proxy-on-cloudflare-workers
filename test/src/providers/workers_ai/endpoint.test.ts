import { describe, it, expect } from "vitest";
import { WorkersAiEndpoint } from "~/src/providers/workers_ai/endpoint";

describe("WorkersAiEndpoint", () => {
  const testApiKey = "test_workers_ai_api_key";
  const testAccountId = "test_account_id";

  describe("constructor", () => {
    it("should initialize with API key and account ID", () => {
      const endpoint = new WorkersAiEndpoint(testApiKey, testAccountId);
      expect(endpoint.apiKey).toBe(testApiKey);
      expect(endpoint.accountId).toBe(testAccountId);
    });
  });

  describe("available", () => {
    it("should return true when API key is provided", () => {
      const endpoint = new WorkersAiEndpoint(testApiKey, testAccountId);
      expect(endpoint.available()).toBe(true);
    });

    it("should return false when API key is empty", () => {
      const endpoint = new WorkersAiEndpoint("", testAccountId);
      expect(endpoint.available()).toBe(false);
    });

    it("should return false when API key is null", () => {
      const endpoint = new WorkersAiEndpoint(null as any, testAccountId);
      expect(endpoint.available()).toBe(false);
    });

    it("should return false when API key is undefined", () => {
      const endpoint = new WorkersAiEndpoint(undefined as any, testAccountId);
      expect(endpoint.available()).toBe(false);
    });
  });

  describe("baseUrl", () => {
    it("should return correct Workers AI API base URL with account ID", () => {
      const endpoint = new WorkersAiEndpoint(testApiKey, testAccountId);
      expect(endpoint.baseUrl()).toBe(
        `https://api.cloudflare.com/client/v4/accounts/${testAccountId}/ai`,
      );
    });
  });

  describe("headers", () => {
    it("should return correct headers with authorization", () => {
      const endpoint = new WorkersAiEndpoint(testApiKey, testAccountId);
      const headers = endpoint.headers();

      expect(headers).toEqual({
        "Content-Type": "application/json",
        Authorization: `Bearer ${testApiKey}`,
      });
    });
  });

  describe("inheritance", () => {
    it("should extend EndpointBase", () => {
      const endpoint = new WorkersAiEndpoint(testApiKey, testAccountId);
      expect(endpoint).toHaveProperty("available");
      expect(endpoint).toHaveProperty("baseUrl");
      expect(endpoint).toHaveProperty("headers");
    });
  });
});
