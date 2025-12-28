import { describe, it, expect, vi, beforeEach } from "vitest";
import { CerebrasEndpoint } from "~/src/providers/cerebras/endpoint";
import { Cerebras } from "~/src/providers/cerebras/provider";

vi.mock("~/src/providers/cerebras/endpoint");

describe("Cerebras Provider", () => {
  const MockCerebrasEndpoint = vi.mocked(CerebrasEndpoint);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with API key name", () => {
      const provider = new Cerebras();
      expect(MockCerebrasEndpoint).toHaveBeenCalledWith("CEREBRAS_API_KEY");
      expect(provider.apiKeyName).toBe("CEREBRAS_API_KEY");
    });

    it("should have correct paths", () => {
      const provider = new Cerebras();
      expect(provider.chatCompletionPath).toBe("/chat/completions");
      expect(provider.modelsPath).toBe("/models");
    });
  });

  describe("inheritance", () => {
    it("should extend ProviderBase", () => {
      const provider = new Cerebras();
      expect(provider).toHaveProperty("available");
      expect(provider).toHaveProperty("buildModelsRequest");
      expect(provider).toHaveProperty("buildChatCompletionsRequest");
    });
  });

  describe("endpoint property", () => {
    it("should have CerebrasEndpoint instance", () => {
      const provider = new Cerebras();
      expect(provider.endpoint).toBeInstanceOf(MockCerebrasEndpoint);
    });
  });
});
