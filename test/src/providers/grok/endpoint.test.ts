import { describe, it, expect, vi, beforeEach } from "vitest";
import { GrokEndpoint } from "~/src/providers/grok/endpoint";
import * as Secrets from "~/src/utils/secrets";

vi.mock("~/src/utils/secrets");

describe("GrokEndpoint", () => {
  const mockSecretsGet = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Secrets.Secrets.get).mockImplementation(mockSecretsGet);
  });

  describe("constructor", () => {
    it("should initialize with API key", () => {
      const testApiKey = "test_grok_api_key";
      const endpoint = new GrokEndpoint(testApiKey);

      expect(endpoint).toBeInstanceOf(GrokEndpoint);
    });
  });

  describe("available", () => {
    it("should return true when API key is provided", () => {
      const testApiKey = "test_grok_api_key";
      const endpoint = new GrokEndpoint(testApiKey);

      expect(endpoint.available()).toBe(true);
    });

    it("should return false when API key is empty", () => {
      const endpoint = new GrokEndpoint("");

      expect(endpoint.available()).toBe(false);
    });

    it("should return false when API key is undefined", () => {
      const endpoint = new GrokEndpoint(undefined as any);

      expect(endpoint.available()).toBe(false);
    });
  });

  describe("headers", () => {
    it("should return headers with Authorization bearer token", () => {
      const testApiKey = "test_grok_api_key";
      const endpoint = new GrokEndpoint(testApiKey);

      const headers = endpoint.headers();

      expect(headers).toEqual({
        "Content-Type": "application/json",
        Authorization: `Bearer ${testApiKey}`,
      });
    });

    it("should return headers with empty Authorization when no API key", () => {
      const endpoint = new GrokEndpoint("");

      const headers = endpoint.headers();

      expect(headers).toEqual({
        "Content-Type": "application/json",
        Authorization: "Bearer ",
      });
    });
  });

  describe("baseUrl", () => {
    it("should return Grok API base URL", () => {
      const testApiKey = "test_grok_api_key";
      const endpoint = new GrokEndpoint(testApiKey);

      expect(endpoint.baseUrl()).toBe("https://api.x.ai");
    });
  });

  describe("inheritance", () => {
    it("should extend EndpointBase", () => {
      const testApiKey = "test_grok_api_key";
      const endpoint = new GrokEndpoint(testApiKey);

      expect(endpoint).toHaveProperty("available");
      expect(endpoint).toHaveProperty("headers");
      expect(endpoint).toHaveProperty("baseUrl");
    });
  });
});
