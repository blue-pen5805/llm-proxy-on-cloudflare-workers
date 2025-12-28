import { describe, it, expect, vi, beforeEach } from "vitest";
import { ReplicateEndpoint } from "~/src/providers/replicate/endpoint";
import * as Secrets from "~/src/utils/secrets";

vi.mock("~/src/utils/secrets");

describe("ReplicateEndpoint", () => {
  const testApiKey = "test_replicate_api_key";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Secrets.Secrets.getAsync).mockImplementation((key) => {
      if (key === "REPLICATE_API_KEY") return Promise.resolve(testApiKey);
      return Promise.resolve("");
    });
    vi.mocked(Secrets.Secrets.getAll).mockImplementation((key) => {
      if (key === "REPLICATE_API_KEY") return [testApiKey];
      return [];
    });
  });

  describe("constructor", () => {
    it("should initialize with API key name", () => {
      const endpoint = new ReplicateEndpoint("REPLICATE_API_KEY");
      expect(endpoint.apiKeyName).toBe("REPLICATE_API_KEY");
    });
  });

  describe("available", () => {
    it("should return true when API key is provided", () => {
      const endpoint = new ReplicateEndpoint("REPLICATE_API_KEY");
      expect(endpoint.available()).toBe(true);
    });

    it("should return false when API key is missing", () => {
      vi.mocked(Secrets.Secrets.getAll).mockReturnValue([]);
      const endpoint = new ReplicateEndpoint("REPLICATE_API_KEY");
      expect(endpoint.available()).toBe(false);
    });
  });

  describe("baseUrl", () => {
    it("should return Replicate API base URL", () => {
      const endpoint = new ReplicateEndpoint("REPLICATE_API_KEY");
      expect(endpoint.baseUrl()).toBe("https://api.replicate.com/v1");
    });
  });

  describe("headers", () => {
    it("should return correct headers with Token authorization", async () => {
      const endpoint = new ReplicateEndpoint("REPLICATE_API_KEY");
      const headers = await endpoint.headers();

      expect(headers).toEqual({
        "Content-Type": "application/json",
        Authorization: `Token ${testApiKey}`,
      });
    });
  });
});
