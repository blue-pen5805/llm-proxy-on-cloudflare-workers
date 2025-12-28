import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenAIEndpoint } from "~/src/providers/openai/endpoint";
import * as Secrets from "~/src/utils/secrets";

vi.mock("~/src/utils/secrets");

describe("OpenAIEndpoint", () => {
  const testApiKey = "sk-test-api-key";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Secrets.Secrets.get).mockImplementation((key) => {
      if (key === "OPENAI_API_KEY") return testApiKey;
      return "";
    });
    vi.mocked(Secrets.Secrets.getAll).mockImplementation((key) => {
      if (key === "OPENAI_API_KEY") return [testApiKey];
      return [];
    });
  });

  describe("constructor", () => {
    it("should initialize with key name", () => {
      const endpoint = new OpenAIEndpoint("OPENAI_API_KEY");
      expect(endpoint.apiKeyName).toBe("OPENAI_API_KEY");
    });
  });

  describe("available", () => {
    it("should return true when API key is provided", () => {
      const endpoint = new OpenAIEndpoint("OPENAI_API_KEY");
      expect(endpoint.available()).toBe(true);
    });

    it("should return false when API key is missing", () => {
      vi.mocked(Secrets.Secrets.getAll).mockReturnValue([]);
      const endpoint = new OpenAIEndpoint("OPENAI_API_KEY");
      expect(endpoint.available()).toBe(false);
    });
  });

  describe("baseUrl", () => {
    it("should return OpenAI API base URL", () => {
      const endpoint = new OpenAIEndpoint("OPENAI_API_KEY");
      expect(endpoint.baseUrl()).toBe("https://api.openai.com/v1");
    });
  });

  describe("headers", () => {
    it("should return headers with Authorization bearer token", async () => {
      const endpoint = new OpenAIEndpoint("OPENAI_API_KEY");
      const headers = await endpoint.headers();

      expect(headers).toEqual({
        "Content-Type": "application/json",
        Authorization: `Bearer ${testApiKey}`,
      });
    });
  });

  describe("inheritance", () => {
    it("should extend EndpointBase", () => {
      const endpoint = new OpenAIEndpoint("OPENAI_API_KEY");
      expect(endpoint).toHaveProperty("pathnamePrefix");
      expect(endpoint).toHaveProperty("requestData");
      expect(endpoint).toHaveProperty("fetch");
    });
  });
});
