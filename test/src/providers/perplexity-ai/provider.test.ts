import { describe, it, expect, vi, beforeEach } from "vitest";
import { PerplexityAiEndpoint } from "~/src/providers/perplexity-ai/endpoint";
import { PerplexityAi } from "~/src/providers/perplexity-ai/provider";

vi.mock("~/src/providers/perplexity-ai/endpoint");

describe("PerplexityAi Provider", () => {
  const MockPerplexityAiEndpoint = vi.mocked(PerplexityAiEndpoint);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with API key name", () => {
      const provider = new PerplexityAi();
      expect(MockPerplexityAiEndpoint).toHaveBeenCalledWith(
        "PERPLEXITYAI_API_KEY",
      );
      expect(provider.apiKeyName).toBe("PERPLEXITYAI_API_KEY");
    });

    it("should have correct paths", () => {
      const provider = new PerplexityAi();
      expect(provider.chatCompletionPath).toBe("/v1/chat/completions");
      expect(provider.modelsPath).toBe("/v1/models");
    });
  });

  describe("buildModelsRequest", () => {
    it("should throw ProviderNotSupportedError", async () => {
      const provider = new PerplexityAi();

      await expect(provider.buildModelsRequest()).rejects.toThrow(
        "Perplexity AI does not support models list via this proxy.",
      );
    });
  });

  describe("inheritance", () => {
    it("should extend ProviderBase", () => {
      const provider = new PerplexityAi();
      expect(provider).toHaveProperty("available");
      expect(provider).toHaveProperty("buildModelsRequest");
      expect(provider).toHaveProperty("buildChatCompletionsRequest");
    });
  });

  describe("endpoint property", () => {
    it("should have PerplexityAiEndpoint instance", () => {
      const provider = new PerplexityAi();
      expect(provider.endpoint).toBeInstanceOf(MockPerplexityAiEndpoint);
    });
  });
});
