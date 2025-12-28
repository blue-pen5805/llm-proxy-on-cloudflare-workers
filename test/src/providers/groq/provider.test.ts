import { describe, it, expect, vi, beforeEach } from "vitest";
import { GroqEndpoint } from "~/src/providers/groq/endpoint";
import { Groq } from "~/src/providers/groq/provider";

vi.mock("~/src/providers/groq/endpoint");

describe("Groq Provider", () => {
  const MockGroqEndpoint = vi.mocked(GroqEndpoint);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with API key name", () => {
      const provider = new Groq();
      expect(MockGroqEndpoint).toHaveBeenCalledWith("GROQ_API_KEY");
      expect(provider.apiKeyName).toBe("GROQ_API_KEY");
    });

    it("should have correct paths", () => {
      const provider = new Groq();
      expect(provider.chatCompletionPath).toBe("/chat/completions");
      expect(provider.modelsPath).toBe("/models");
    });
  });

  describe("inheritance", () => {
    it("should extend ProviderBase", () => {
      const provider = new Groq();
      expect(provider).toHaveProperty("available");
      expect(provider).toHaveProperty("buildModelsRequest");
      expect(provider).toHaveProperty("buildChatCompletionsRequest");
    });
  });

  describe("endpoint property", () => {
    it("should have GroqEndpoint instance", () => {
      const provider = new Groq();
      expect(provider.endpoint).toBeInstanceOf(MockGroqEndpoint);
    });
  });
});
