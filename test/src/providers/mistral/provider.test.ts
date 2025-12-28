import { describe, it, expect, vi, beforeEach } from "vitest";
import { MistralEndpoint } from "~/src/providers/mistral/endpoint";
import { Mistral } from "~/src/providers/mistral/provider";

vi.mock("~/src/providers/mistral/endpoint");

describe("Mistral Provider", () => {
  const MockMistralEndpoint = vi.mocked(MistralEndpoint);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with API key name", () => {
      const provider = new Mistral();
      expect(MockMistralEndpoint).toHaveBeenCalledWith("MISTRAL_API_KEY");
      expect(provider.apiKeyName).toBe("MISTRAL_API_KEY");
    });

    it("should have correct paths", () => {
      const provider = new Mistral();
      expect(provider.chatCompletionPath).toBe("/v1/chat/completions");
      expect(provider.modelsPath).toBe("/v1/models");
    });
  });

  describe("inheritance", () => {
    it("should extend ProviderBase", () => {
      const provider = new Mistral();
      expect(provider).toHaveProperty("available");
      expect(provider).toHaveProperty("buildModelsRequest");
      expect(provider).toHaveProperty("buildChatCompletionsRequest");
    });
  });

  describe("endpoint property", () => {
    it("should have MistralEndpoint instance", () => {
      const provider = new Mistral();
      expect(provider.endpoint).toBeInstanceOf(MockMistralEndpoint);
    });
  });
});
