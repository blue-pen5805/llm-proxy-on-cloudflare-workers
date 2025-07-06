import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OpenAIModelsListResponseBody } from "~/src/providers/openai/types";
import { PerplexityAiEndpoint } from "~/src/providers/perplexity-ai/endpoint";
import { PerplexityAi } from "~/src/providers/perplexity-ai/provider";
import { ProviderNotSupportedError } from "~/src/providers/provider";
import * as Secrets from "~/src/utils/secrets";

vi.mock("~/src/utils/secrets");
vi.mock("~/src/providers/perplexity-ai/endpoint");

describe("PerplexityAi Provider", () => {
  const mockSecretsGet = vi.fn();
  const MockPerplexityAiEndpoint = vi.mocked(PerplexityAiEndpoint);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Secrets.Secrets.get).mockImplementation(mockSecretsGet);
  });

  describe("constructor", () => {
    it("should initialize with API key from secrets", () => {
      const testApiKey = "test_perplexity_api_key";
      mockSecretsGet.mockReturnValue(testApiKey);

      const provider = new PerplexityAi();

      expect(Secrets.Secrets.get).toHaveBeenCalledWith("PERPLEXITYAI_API_KEY");
      expect(MockPerplexityAiEndpoint).toHaveBeenCalledWith(testApiKey);
      expect(provider.apiKeyName).toBe("PERPLEXITYAI_API_KEY");
    });

    it("should have correct paths", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new PerplexityAi();

      expect(provider.chatCompletionPath).toBe("/v1/chat/completions");
      expect(provider.modelsPath).toBe("/v1/models");
    });
  });

  describe("buildModelsRequest", () => {
    it("should throw ProviderNotSupportedError", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new PerplexityAi();

      expect(() => {
        provider.buildModelsRequest();
      }).toThrow(ProviderNotSupportedError);

      expect(() => {
        provider.buildModelsRequest();
      }).toThrow("Perplexity AI does not support list models");
    });
  });

  describe("modelsToOpenAIFormat", () => {
    it("should convert OpenAI models response to OpenAI format (passthrough)", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new PerplexityAi();

      const openaiResponse: OpenAIModelsListResponseBody = {
        object: "list",
        data: [
          {
            id: "llama-3.1-sonar-small-128k-online",
            object: "model",
            created: 1699573300,
            owned_by: "perplexity",
          },
        ],
      };

      const result = provider.modelsToOpenAIFormat(openaiResponse);

      expect(result).toEqual({
        object: "list",
        data: [
          {
            id: "llama-3.1-sonar-small-128k-online",
            object: "model",
            created: 1699573300,
            owned_by: "perplexity",
          },
        ],
      });
    });

    it("should handle empty models list", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new PerplexityAi();

      const openaiResponse: OpenAIModelsListResponseBody = {
        object: "list",
        data: [],
      };

      const result = provider.modelsToOpenAIFormat(openaiResponse);

      expect(result).toEqual({
        object: "list",
        data: [],
      });
    });
  });

  describe("inheritance", () => {
    it("should extend ProviderBase", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new PerplexityAi();

      expect(provider).toHaveProperty("available");
      expect(provider).toHaveProperty("buildModelsRequest");
      expect(provider).toHaveProperty("buildChatCompletionsRequest");
    });
  });

  describe("endpoint property", () => {
    it("should have PerplexityAiEndpoint instance", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new PerplexityAi();

      expect(provider.endpoint).toBeInstanceOf(MockPerplexityAiEndpoint);
    });
  });
});
