import { describe, it, expect, vi, beforeEach } from "vitest";
import { MistralEndpoint } from "~/src/providers/mistral/endpoint";
import * as Secrets from "~/src/utils/secrets";

vi.mock("~/src/utils/secrets");

describe("MistralEndpoint", () => {
  const mockSecretsGet = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Secrets.Secrets.get).mockImplementation(mockSecretsGet);
  });

  describe("constructor", () => {
    it("should initialize with API key", () => {
      const testApiKey = "test_mistral_api_key";
      const endpoint = new MistralEndpoint(testApiKey);

      expect(endpoint).toBeInstanceOf(MistralEndpoint);
    });
  });

  describe("available", () => {
    it("should return true when API key is provided", () => {
      const testApiKey = "test_mistral_api_key";
      const endpoint = new MistralEndpoint(testApiKey);

      expect(endpoint.available()).toBe(true);
    });

    it("should return false when API key is empty", () => {
      const endpoint = new MistralEndpoint("");

      expect(endpoint.available()).toBe(false);
    });

    it("should return false when API key is undefined", () => {
      const endpoint = new MistralEndpoint(undefined as any);

      expect(endpoint.available()).toBe(false);
    });
  });

  describe("headers", () => {
    it("should return headers with Authorization bearer token", () => {
      const testApiKey = "test_mistral_api_key";
      const endpoint = new MistralEndpoint(testApiKey);

      const headers = endpoint.headers();

      expect(headers).toEqual({
        "Content-Type": "application/json",
        Authorization: `Bearer ${testApiKey}`,
      });
    });

    it("should return headers with empty Authorization when no API key", () => {
      const endpoint = new MistralEndpoint("");

      const headers = endpoint.headers();

      expect(headers).toEqual({
        "Content-Type": "application/json",
        Authorization: "Bearer ",
      });
    });
  });

  describe("baseUrl", () => {
    it("should return Mistral API base URL", () => {
      const testApiKey = "test_mistral_api_key";
      const endpoint = new MistralEndpoint(testApiKey);

      expect(endpoint.baseUrl()).toBe("https://api.mistral.ai");
    });
  });

  describe("inheritance", () => {
    it("should extend EndpointBase", () => {
      const testApiKey = "test_mistral_api_key";
      const endpoint = new MistralEndpoint(testApiKey);

      expect(endpoint).toHaveProperty("available");
      expect(endpoint).toHaveProperty("headers");
      expect(endpoint).toHaveProperty("baseUrl");
    });
  });
});
