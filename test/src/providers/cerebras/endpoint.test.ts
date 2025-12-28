import { describe, it, expect, vi, beforeEach } from "vitest";
import { CerebrasEndpoint } from "~/src/providers/cerebras/endpoint";
import * as Secrets from "~/src/utils/secrets";

vi.mock("~/src/utils/secrets");

describe("CerebrasEndpoint", () => {
  const testApiKey = "test_cerebras_api_key";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Secrets.Secrets.get).mockImplementation((key) => {
      if (key === "CEREBRAS_API_KEY") return testApiKey;
      return "";
    });
    vi.mocked(Secrets.Secrets.getAll).mockImplementation((key) => {
      if (key === "CEREBRAS_API_KEY") return [testApiKey];
      return [];
    });
  });

  describe("constructor", () => {
    it("should initialize with API key name", () => {
      const endpoint = new CerebrasEndpoint("CEREBRAS_API_KEY");
      expect(endpoint.apiKeyName).toBe("CEREBRAS_API_KEY");
    });
  });

  describe("available", () => {
    it("should return true when API key is provided", () => {
      const endpoint = new CerebrasEndpoint("CEREBRAS_API_KEY");
      expect(endpoint.available()).toBe(true);
    });

    it("should return false when API key is missing", () => {
      vi.mocked(Secrets.Secrets.getAll).mockReturnValue([]);
      const endpoint = new CerebrasEndpoint("CEREBRAS_API_KEY");
      expect(endpoint.available()).toBe(false);
    });
  });

  describe("baseUrl", () => {
    it("should return Cerebras API base URL", () => {
      const endpoint = new CerebrasEndpoint("CEREBRAS_API_KEY");
      expect(endpoint.baseUrl()).toBe("https://api.cerebras.ai/v1");
    });
  });

  describe("headers", () => {
    it("should return correct headers with authorization", async () => {
      const endpoint = new CerebrasEndpoint("CEREBRAS_API_KEY");
      const headers = await endpoint.headers();

      expect(headers).toEqual({
        "Content-Type": "application/json",
        Authorization: `Bearer ${testApiKey}`,
      });
    });
  });
});
