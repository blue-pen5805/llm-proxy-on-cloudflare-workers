import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenRouter } from "~/src/providers/openrouter/provider";
import * as Secrets from "~/src/utils/secrets";

vi.mock("~/src/utils/secrets");

describe("OpenRouter Provider", () => {
  const testApiKey = "sk-test-api-key";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Secrets.Secrets.get).mockImplementation((key: any) => {
      if (key === "OPENROUTER_API_KEY") return testApiKey;
      return "";
    });
    vi.mocked(Secrets.Secrets.getAll).mockImplementation((key: any) => {
      if (key === "OPENROUTER_API_KEY") return [testApiKey];
      return [];
    });
  });

  describe("properties", () => {
    it("should have correct API key name and base URL", () => {
      const provider = new OpenRouter();
      expect(provider.apiKeyName).toBe("OPENROUTER_API_KEY");
      expect(provider.baseUrl()).toBe("https://openrouter.ai/api");
    });
  });

  describe("available", () => {
    it("should return true when API key is provided", () => {
      const provider = new OpenRouter();
      expect(provider.available()).toBe(true);
    });

    it("should return false when API key is missing", () => {
      vi.mocked(Secrets.Secrets.getAll).mockReturnValue([]);
      const provider = new OpenRouter();
      expect(provider.available()).toBe(false);
    });
  });
});
