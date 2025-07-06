import { describe, it, expect, vi, beforeEach } from "vitest";
import { CohereEndpoint } from "~/src/providers/cohere/endpoint";
import * as Secrets from "~/src/utils/secrets";

vi.mock("~/src/utils/secrets");

describe("CohereEndpoint", () => {
  const mockSecretsGet = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Secrets.Secrets.get).mockImplementation(mockSecretsGet);
  });

  describe("constructor", () => {
    it("should initialize with API key", () => {
      const testApiKey = "test_cohere_api_key";
      const endpoint = new CohereEndpoint(testApiKey);

      expect(endpoint).toBeInstanceOf(CohereEndpoint);
    });
  });

  describe("available", () => {
    it("should return true when API key is provided", () => {
      const testApiKey = "test_cohere_api_key";
      const endpoint = new CohereEndpoint(testApiKey);

      expect(endpoint.available()).toBe(true);
    });

    it("should return false when API key is empty", () => {
      const endpoint = new CohereEndpoint("");

      expect(endpoint.available()).toBe(false);
    });

    it("should return false when API key is undefined", () => {
      const endpoint = new CohereEndpoint(undefined as any);

      expect(endpoint.available()).toBe(false);
    });
  });

  describe("headers", () => {
    it("should return headers with Authorization bearer token", () => {
      const testApiKey = "test_cohere_api_key";
      const endpoint = new CohereEndpoint(testApiKey);

      const headers = endpoint.headers();

      expect(headers).toEqual({
        "Content-Type": "application/json",
        Authorization: `Bearer ${testApiKey}`,
      });
    });

    it("should return headers with empty Authorization when no API key", () => {
      const endpoint = new CohereEndpoint("");

      const headers = endpoint.headers();

      expect(headers).toEqual({
        "Content-Type": "application/json",
        Authorization: "Bearer ",
      });
    });
  });

  describe("baseUrl", () => {
    it("should return Cohere API base URL", () => {
      const testApiKey = "test_cohere_api_key";
      const endpoint = new CohereEndpoint(testApiKey);

      expect(endpoint.baseUrl()).toBe("https://api.cohere.com");
    });
  });

  describe("inheritance", () => {
    it("should extend EndpointBase", () => {
      const testApiKey = "test_cohere_api_key";
      const endpoint = new CohereEndpoint(testApiKey);

      expect(endpoint).toHaveProperty("available");
      expect(endpoint).toHaveProperty("headers");
      expect(endpoint).toHaveProperty("baseUrl");
    });
  });
});
