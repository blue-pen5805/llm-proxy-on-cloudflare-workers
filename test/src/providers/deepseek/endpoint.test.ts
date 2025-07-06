import { describe, it, expect, vi, beforeEach } from "vitest";
import { DeepSeekEndpoint } from "~/src/providers/deepseek/endpoint";
import * as Secrets from "~/src/utils/secrets";

vi.mock("~/src/utils/secrets");

describe("DeepSeekEndpoint", () => {
  const mockSecretsGet = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Secrets.Secrets.get).mockImplementation(mockSecretsGet);
  });

  describe("constructor", () => {
    it("should initialize with API key", () => {
      const testApiKey = "test_deepseek_api_key";
      const endpoint = new DeepSeekEndpoint(testApiKey);

      expect(endpoint).toBeInstanceOf(DeepSeekEndpoint);
    });
  });

  describe("available", () => {
    it("should return true when API key is provided", () => {
      const testApiKey = "test_deepseek_api_key";
      const endpoint = new DeepSeekEndpoint(testApiKey);

      expect(endpoint.available()).toBe(true);
    });

    it("should return false when API key is empty", () => {
      const endpoint = new DeepSeekEndpoint("");

      expect(endpoint.available()).toBe(false);
    });

    it("should return false when API key is undefined", () => {
      const endpoint = new DeepSeekEndpoint(undefined as any);

      expect(endpoint.available()).toBe(false);
    });
  });

  describe("headers", () => {
    it("should return headers with Authorization bearer token", () => {
      const testApiKey = "test_deepseek_api_key";
      const endpoint = new DeepSeekEndpoint(testApiKey);

      const headers = endpoint.headers();

      expect(headers).toEqual({
        "Content-Type": "application/json",
        Authorization: `Bearer ${testApiKey}`,
      });
    });

    it("should return headers with empty Authorization when no API key", () => {
      const endpoint = new DeepSeekEndpoint("");

      const headers = endpoint.headers();

      expect(headers).toEqual({
        "Content-Type": "application/json",
        Authorization: "Bearer ",
      });
    });
  });

  describe("baseUrl", () => {
    it("should return DeepSeek API base URL", () => {
      const testApiKey = "test_deepseek_api_key";
      const endpoint = new DeepSeekEndpoint(testApiKey);

      expect(endpoint.baseUrl()).toBe("https://api.deepseek.com");
    });
  });

  describe("inheritance", () => {
    it("should extend EndpointBase", () => {
      const testApiKey = "test_deepseek_api_key";
      const endpoint = new DeepSeekEndpoint(testApiKey);

      expect(endpoint).toHaveProperty("available");
      expect(endpoint).toHaveProperty("headers");
      expect(endpoint).toHaveProperty("baseUrl");
    });
  });
});
