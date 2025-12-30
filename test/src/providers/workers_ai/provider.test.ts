import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkersAi } from "~/src/providers/workers_ai/provider";
import * as Secrets from "~/src/utils/secrets";

vi.mock("~/src/utils/secrets");

describe("WorkersAi Provider", () => {
  const testApiKey = "sk-test-api-key";
  const testAccountId = "test-account-id";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Secrets.Secrets.get).mockImplementation((key: any) => {
      if (key === "CLOUDFLARE_API_KEY") return testApiKey;
      if (key === "CLOUDFLARE_ACCOUNT_ID") return testAccountId;
      return "";
    });
    vi.mocked(Secrets.Secrets.getAll).mockImplementation((key: any) => {
      if (key === "CLOUDFLARE_API_KEY") return [testApiKey];
      if (key === "CLOUDFLARE_ACCOUNT_ID") return [testAccountId];
      return [];
    });
  });

  describe("properties", () => {
    it("should have correct API key name and base URL", () => {
      const provider = new WorkersAi();
      expect(provider.apiKeyName).toBe("CLOUDFLARE_API_KEY");
      expect(provider.baseUrl()).toBe(
        `https://api.cloudflare.com/client/v4/accounts/${testAccountId}/ai`,
      );
    });
  });

  describe("available", () => {
    it("should return true when API key and account ID are provided", () => {
      const provider = new WorkersAi();
      expect(provider.available()).toBe(true);
    });

    it("should return false when API key is missing", () => {
      vi.mocked(Secrets.Secrets.getAll).mockImplementation((key: any) => {
        if (key === "CLOUDFLARE_API_KEY") return [];
        if (key === "CLOUDFLARE_ACCOUNT_ID") return [testAccountId];
        return [];
      });
      const provider = new WorkersAi();
      expect(provider.available()).toBe(false);
    });
  });
});
