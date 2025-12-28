import { describe, it, expect, vi, beforeEach } from "vitest";
import { AnthropicEndpoint } from "~/src/providers/anthropic/endpoint";
import { Anthropic } from "~/src/providers/anthropic/provider";

vi.mock("~/src/providers/anthropic/endpoint");

describe("Anthropic Provider", () => {
  const MockAnthropicEndpoint = vi.mocked(AnthropicEndpoint);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with API key name", () => {
      const provider = new Anthropic();
      expect(MockAnthropicEndpoint).toHaveBeenCalledWith("ANTHROPIC_API_KEY");
      expect(provider.apiKeyName).toBe("ANTHROPIC_API_KEY");
    });
  });

  describe("inheritance", () => {
    it("should extend ProviderBase", () => {
      const provider = new Anthropic();

      expect(provider).toHaveProperty("chatCompletionPath");
      expect(provider).toHaveProperty("modelsPath");
      expect(provider).toHaveProperty("available");
      expect(provider).toHaveProperty("buildModelsRequest");
      expect(provider).toHaveProperty("buildChatCompletionsRequest");
    });
  });

  describe("endpoint property", () => {
    it("should have AnthropicEndpoint instance", () => {
      const provider = new Anthropic();
      expect(provider.endpoint).toBeInstanceOf(MockAnthropicEndpoint);
    });
  });
});
