import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenAIEndpoint } from "~/src/providers/openai/endpoint";
import { OpenAI } from "~/src/providers/openai/provider";

vi.mock("~/src/providers/openai/endpoint");

describe("OpenAI Provider", () => {
  const MockOpenAIEndpoint = vi.mocked(OpenAIEndpoint);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with API key name", () => {
      const provider = new OpenAI();
      expect(MockOpenAIEndpoint).toHaveBeenCalledWith("OPENAI_API_KEY");
      expect(provider.apiKeyName).toBe("OPENAI_API_KEY");
    });
  });

  describe("inheritance", () => {
    it("should extend ProviderBase", () => {
      const provider = new OpenAI();

      expect(provider).toHaveProperty("chatCompletionPath");
      expect(provider).toHaveProperty("modelsPath");
      expect(provider).toHaveProperty("available");
      expect(provider).toHaveProperty("buildModelsRequest");
      expect(provider).toHaveProperty("buildChatCompletionsRequest");
    });
  });

  describe("endpoint property", () => {
    it("should have OpenAIEndpoint instance", () => {
      const provider = new OpenAI();
      expect(provider.endpoint).toBeInstanceOf(MockOpenAIEndpoint);
    });
  });
});
