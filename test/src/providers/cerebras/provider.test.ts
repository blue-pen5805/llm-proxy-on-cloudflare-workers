import { describe, it, expect, vi, beforeEach } from "vitest";
import { Cerebras } from "~/src/providers/cerebras/provider";
import * as Secrets from "~/src/utils/secrets";

vi.mock("~/src/utils/secrets");

describe("Cerebras Provider", () => {
  const testApiKey = "sk-test-api-key";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Secrets.Secrets.get).mockImplementation((key: any) => {
      if (key === "CEREBRAS_API_KEY") return testApiKey;
      return "";
    });
    vi.mocked(Secrets.Secrets.getAll).mockImplementation((key: any) => {
      if (key === "CEREBRAS_API_KEY") return [testApiKey];
      return [];
    });
  });

  describe("properties", () => {
    it("should have correct API key name and base URL", () => {
      const provider = new Cerebras();
      expect(provider.apiKeyName).toBe("CEREBRAS_API_KEY");
      expect(provider.baseUrl()).toBe("https://api.cerebras.ai/v1");
    });
  });

  describe("available", () => {
    it("should return true when API key is provided", () => {
      const provider = new Cerebras();
      expect(provider.available()).toBe(true);
    });

    it("should return false when API key is missing", () => {
      vi.mocked(Secrets.Secrets.getAll).mockReturnValue([]);
      const provider = new Cerebras();
      expect(provider.available()).toBe(false);
    });
  });
});
