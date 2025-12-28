import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkersAiEndpoint } from "~/src/providers/workers_ai/endpoint";
import * as Secrets from "~/src/utils/secrets";

vi.mock("~/src/utils/secrets");

describe("WorkersAiEndpoint", () => {
  const testApiKey = "test_workers_ai_api_key";
  const testAccountId = "test_account_id";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Secrets.Secrets.get).mockImplementation((key) => {
      if (key === "CLOUDFLARE_API_KEY") return testApiKey;
      if (key === "CLOUDFLARE_ACCOUNT_ID")
        return Promise.resolve(testAccountId);
      return "";
    });
    vi.mocked(Secrets.Secrets.get).mockImplementation((key) => {
      if (key === "CLOUDFLARE_API_KEY") return testApiKey;
      if (key === "CLOUDFLARE_ACCOUNT_ID") return testAccountId;
      return "";
    });
    vi.mocked(Secrets.Secrets.getAll).mockImplementation((key) => {
      if (key === "CLOUDFLARE_API_KEY") return [testApiKey];
      if (key === "CLOUDFLARE_ACCOUNT_ID") return [testAccountId];
      return [];
    });
  });

  describe("constructor", () => {
    it("should initialize with key names", () => {
      const endpoint = new WorkersAiEndpoint(
        "CLOUDFLARE_API_KEY",
        "CLOUDFLARE_ACCOUNT_ID",
      );
      expect(endpoint.apiKeyName).toBe("CLOUDFLARE_API_KEY");
      expect(endpoint.accountIdName).toBe("CLOUDFLARE_ACCOUNT_ID");
    });
  });

  describe("available", () => {
    it("should return true when API key is provided", () => {
      const endpoint = new WorkersAiEndpoint(
        "CLOUDFLARE_API_KEY",
        "CLOUDFLARE_ACCOUNT_ID",
      );
      expect(endpoint.available()).toBe(true);
    });

    it("should return false when API key is missing", () => {
      vi.mocked(Secrets.Secrets.getAll).mockReturnValue([]);
      const endpoint = new WorkersAiEndpoint(
        "CLOUDFLARE_API_KEY",
        "CLOUDFLARE_ACCOUNT_ID",
      );
      expect(endpoint.available()).toBe(false);
    });
  });

  describe("baseUrl", () => {
    it("should return correct Workers AI API base URL with account ID", () => {
      const endpoint = new WorkersAiEndpoint(
        "CLOUDFLARE_API_KEY",
        "CLOUDFLARE_ACCOUNT_ID",
      );
      expect(endpoint.baseUrl()).toBe(
        `https://api.cloudflare.com/client/v4/accounts/${testAccountId}/ai`,
      );
    });
  });

  describe("headers", () => {
    it("should return correct headers with authorization", async () => {
      const endpoint = new WorkersAiEndpoint(
        "CLOUDFLARE_API_KEY",
        "CLOUDFLARE_ACCOUNT_ID",
      );
      const headers = await endpoint.headers();

      expect(headers).toEqual({
        "Content-Type": "application/json",
        Authorization: `Bearer ${testApiKey}`,
      });
    });
  });

  describe("inheritance", () => {
    it("should extend EndpointBase", () => {
      const endpoint = new WorkersAiEndpoint(
        "CLOUDFLARE_API_KEY",
        "CLOUDFLARE_ACCOUNT_ID",
      );
      expect(endpoint).toHaveProperty("available");
      expect(endpoint).toHaveProperty("baseUrl");
      expect(endpoint).toHaveProperty("headers");
    });
  });
});
