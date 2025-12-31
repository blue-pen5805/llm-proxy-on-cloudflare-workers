import { describe, it, expect, vi, beforeEach } from "vitest";
import { Ollama } from "~/src/providers/ollama/provider";
import * as Secrets from "~/src/utils/secrets";

vi.mock("~/src/utils/secrets");

describe("Ollama Provider", () => {
  const testApiKey = "ollama-test-api-key";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Secrets.Secrets.get).mockImplementation((key: any) => {
      if (key === "OLLAMA_API_KEY") return testApiKey;
      return "";
    });
    vi.mocked(Secrets.Secrets.getAll).mockImplementation((key: any) => {
      if (key === "OLLAMA_API_KEY") return [testApiKey];
      return [];
    });
  });

  describe("properties", () => {
    it("should have correct API key name and base URL", () => {
      const provider = new Ollama();
      expect(provider.apiKeyName).toBe("OLLAMA_API_KEY");
      expect(provider.baseUrl()).toBe("https://ollama.com/v1");
    });
  });

  describe("available", () => {
    it("should return true when API key is provided", () => {
      const provider = new Ollama();
      expect(provider.available()).toBe(true);
    });

    it("should return false when API key is missing", () => {
      vi.mocked(Secrets.Secrets.getAll).mockReturnValue([]);
      const provider = new Ollama();
      expect(provider.available()).toBe(false);
    });
  });
});
