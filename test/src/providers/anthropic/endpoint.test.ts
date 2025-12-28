import { describe, it, expect, vi, beforeEach } from "vitest";
import { AnthropicEndpoint } from "~/src/providers/anthropic/endpoint";
import * as Secrets from "~/src/utils/secrets";

vi.mock("~/src/utils/secrets");

describe("AnthropicEndpoint", () => {
  const testApiKey = "sk-ant-test-api-key";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Secrets.Secrets.getAsync).mockImplementation((key) => {
      if (key === "ANTHROPIC_API_KEY") return Promise.resolve(testApiKey);
      return Promise.resolve("");
    });
    vi.mocked(Secrets.Secrets.getAll).mockImplementation((key) => {
      if (key === "ANTHROPIC_API_KEY") return [testApiKey];
      return [];
    });
  });

  describe("constructor", () => {
    it("should initialize with key name", () => {
      const endpoint = new AnthropicEndpoint("ANTHROPIC_API_KEY");
      expect(endpoint.apiKeyName).toBe("ANTHROPIC_API_KEY");
    });
  });

  describe("available", () => {
    it("should return true when API key is provided", () => {
      const endpoint = new AnthropicEndpoint("ANTHROPIC_API_KEY");
      expect(endpoint.available()).toBe(true);
    });

    it("should return false when API key is missing", () => {
      vi.mocked(Secrets.Secrets.getAll).mockReturnValue([]);
      const endpoint = new AnthropicEndpoint("ANTHROPIC_API_KEY");
      expect(endpoint.available()).toBe(false);
    });
  });

  describe("baseUrl", () => {
    it("should return Anthropic API base URL", () => {
      const endpoint = new AnthropicEndpoint("ANTHROPIC_API_KEY");
      expect(endpoint.baseUrl()).toBe("https://api.anthropic.com");
    });
  });

  describe("headers", () => {
    it("should return headers with x-api-key and anthropic-version", async () => {
      const endpoint = new AnthropicEndpoint("ANTHROPIC_API_KEY");
      const headers = await endpoint.headers();

      expect(headers).toEqual({
        "Content-Type": "application/json",
        "x-api-key": testApiKey,
        "anthropic-version": "2023-06-01",
      });
    });
  });

  describe("inheritance", () => {
    it("should extend EndpointBase", () => {
      const endpoint = new AnthropicEndpoint("ANTHROPIC_API_KEY");
      expect(endpoint).toHaveProperty("available");
      expect(endpoint).toHaveProperty("baseUrl");
      expect(endpoint).toHaveProperty("headers");
    });
  });
});
