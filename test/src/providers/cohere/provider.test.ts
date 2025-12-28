import { describe, it, expect, vi, beforeEach } from "vitest";
import { CohereEndpoint } from "~/src/providers/cohere/endpoint";
import { Cohere } from "~/src/providers/cohere/provider";

vi.mock("~/src/providers/cohere/endpoint");

describe("Cohere Provider", () => {
  const MockCohereEndpoint = vi.mocked(CohereEndpoint);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with API key name", () => {
      const provider = new Cohere();
      expect(MockCohereEndpoint).toHaveBeenCalledWith("COHERE_API_KEY");
      expect(provider.apiKeyName).toBe("COHERE_API_KEY");
    });

    it("should have correct paths", () => {
      const provider = new Cohere();
      expect(provider.chatCompletionPath).toBe(
        "/compatibility/v1/chat/completions",
      );
      expect(provider.modelsPath).toBe(
        "/v1/models?page_size=100&endpoint=chat",
      );
    });
  });

  describe("inheritance", () => {
    it("should extend ProviderBase", () => {
      const provider = new Cohere();
      expect(provider).toHaveProperty("available");
      expect(provider).toHaveProperty("buildModelsRequest");
      expect(provider).toHaveProperty("buildChatCompletionsRequest");
    });
  });

  describe("endpoint property", () => {
    it("should have CohereEndpoint instance", () => {
      const provider = new Cohere();
      expect(provider.endpoint).toBeInstanceOf(MockCohereEndpoint);
    });
  });
});
