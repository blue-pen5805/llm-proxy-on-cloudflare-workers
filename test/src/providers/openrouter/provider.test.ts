import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenRouterEndpoint } from "~/src/providers/openrouter/endpoint";
import { OpenRouter } from "~/src/providers/openrouter/provider";

vi.mock("~/src/providers/openrouter/endpoint");

describe("OpenRouter Provider", () => {
  const MockOpenRouterEndpoint = vi.mocked(OpenRouterEndpoint);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with API key name", () => {
      const provider = new OpenRouter();
      expect(MockOpenRouterEndpoint).toHaveBeenCalledWith("OPENROUTER_API_KEY");
      expect(provider.apiKeyName).toBe("OPENROUTER_API_KEY");
    });

    it("should have correct paths", () => {
      const provider = new OpenRouter();
      expect(provider.chatCompletionPath).toBe("/v1/chat/completions");
      expect(provider.modelsPath).toBe("/v1/models");
    });
  });

  describe("inheritance", () => {
    it("should extend ProviderBase", () => {
      const provider = new OpenRouter();
      expect(provider).toHaveProperty("available");
      expect(provider).toHaveProperty("buildModelsRequest");
      expect(provider).toHaveProperty("buildChatCompletionsRequest");
    });
  });

  describe("endpoint property", () => {
    it("should have OpenRouterEndpoint instance", () => {
      const provider = new OpenRouter();
      expect(provider.endpoint).toBeInstanceOf(MockOpenRouterEndpoint);
    });
  });
});
