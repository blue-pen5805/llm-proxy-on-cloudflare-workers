import { describe, it, expect, vi, beforeEach } from "vitest";
import { PerplexityAiEndpoint } from "~/src/providers/perplexity-ai/endpoint";
import * as Secrets from "~/src/utils/secrets";

vi.mock("~/src/utils/secrets");

describe("PerplexityAiEndpoint", () => {
  const testApiKey = "test_perplexity_api_key";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Secrets.Secrets.get).mockImplementation((key) => {
      if (key === "PERPLEXITYAI_API_KEY") return testApiKey;
      return "";
    });
    vi.mocked(Secrets.Secrets.getAll).mockImplementation((key) => {
      if (key === "PERPLEXITYAI_API_KEY") return [testApiKey];
      return [];
    });
  });

  describe("constructor", () => {
    it("should initialize with API key name", () => {
      const endpoint = new PerplexityAiEndpoint("PERPLEXITYAI_API_KEY");
      expect(endpoint.apiKeyName).toBe("PERPLEXITYAI_API_KEY");
    });
  });

  describe("available", () => {
    it("should return true when API key is provided", () => {
      const endpoint = new PerplexityAiEndpoint("PERPLEXITYAI_API_KEY");
      expect(endpoint.available()).toBe(true);
    });

    it("should return false when API key is missing", () => {
      vi.mocked(Secrets.Secrets.getAll).mockReturnValue([]);
      const endpoint = new PerplexityAiEndpoint("PERPLEXITYAI_API_KEY");
      expect(endpoint.available()).toBe(false);
    });
  });

  describe("baseUrl", () => {
    it("should return Perplexity AI API base URL", () => {
      const endpoint = new PerplexityAiEndpoint("PERPLEXITYAI_API_KEY");
      expect(endpoint.baseUrl()).toBe("https://api.perplexity.ai");
    });
  });

  describe("headers", () => {
    it("should return correct headers with authorization and accept", async () => {
      const endpoint = new PerplexityAiEndpoint("PERPLEXITYAI_API_KEY");
      const headers = await endpoint.headers();

      expect(headers).toEqual({
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${testApiKey}`,
      });
    });
  });
});
