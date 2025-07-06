import { describe, it, expect, vi, beforeEach } from "vitest";
import { CohereEndpoint } from "~/src/providers/cohere/endpoint";
import { Cohere } from "~/src/providers/cohere/provider";
import type { CohereModelsListResponseBody } from "~/src/providers/cohere/types";
import * as Secrets from "~/src/utils/secrets";

vi.mock("~/src/utils/secrets");
vi.mock("~/src/providers/cohere/endpoint");

describe("Cohere Provider", () => {
  const mockSecretsGet = vi.fn();
  const MockCohereEndpoint = vi.mocked(CohereEndpoint);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Secrets.Secrets.get).mockImplementation(mockSecretsGet);
  });

  describe("constructor", () => {
    it("should initialize with API key from secrets", () => {
      const testApiKey = "test_cohere_api_key";
      mockSecretsGet.mockReturnValue(testApiKey);

      const provider = new Cohere();

      expect(Secrets.Secrets.get).toHaveBeenCalledWith("COHERE_API_KEY");
      expect(MockCohereEndpoint).toHaveBeenCalledWith(testApiKey);
      expect(provider.apiKeyName).toBe("COHERE_API_KEY");
    });

    it("should have correct paths", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new Cohere();

      expect(provider.chatCompletionPath).toBe(
        "/compatibility/v1/chat/completions",
      );
      expect(provider.modelsPath).toBe(
        "/v1/models?page_size=100&endpoint=chat",
      );
    });
  });

  describe("modelsToOpenAIFormat", () => {
    it("should convert Cohere models response to OpenAI format", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new Cohere();

      const cohereResponse: CohereModelsListResponseBody = {
        models: [
          {
            name: "command-r",
            endpoints: ["chat"],
            finetuned: false,
            context_length: 128000,
            tokenizer_url:
              "https://storage.googleapis.com/cohere-public/tokenizers/command-r.json",
            default_endpoints: ["chat"],
          },
          {
            name: "command-r-plus",
            endpoints: ["chat"],
            finetuned: false,
            context_length: 128000,
            tokenizer_url:
              "https://storage.googleapis.com/cohere-public/tokenizers/command-r-plus.json",
            default_endpoints: ["chat"],
          },
        ],
      };

      const result = provider.modelsToOpenAIFormat(cohereResponse);

      expect(result).toEqual({
        object: "list",
        data: [
          {
            id: "command-r",
            object: "model",
            created: expect.any(Number),
            owned_by: "cohere",
            _: {
              endpoints: ["chat"],
              finetuned: false,
              context_length: 128000,
              tokenizer_url:
                "https://storage.googleapis.com/cohere-public/tokenizers/command-r.json",
              default_endpoints: ["chat"],
            },
          },
          {
            id: "command-r-plus",
            object: "model",
            created: expect.any(Number),
            owned_by: "cohere",
            _: {
              endpoints: ["chat"],
              finetuned: false,
              context_length: 128000,
              tokenizer_url:
                "https://storage.googleapis.com/cohere-public/tokenizers/command-r-plus.json",
              default_endpoints: ["chat"],
            },
          },
        ],
      });
    });

    it("should handle empty models list", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new Cohere();

      const cohereResponse: CohereModelsListResponseBody = {
        models: [],
      };

      const result = provider.modelsToOpenAIFormat(cohereResponse);

      expect(result).toEqual({
        object: "list",
        data: [],
      });
    });
  });

  describe("inheritance", () => {
    it("should extend ProviderBase", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new Cohere();

      expect(provider).toHaveProperty("available");
      expect(provider).toHaveProperty("buildModelsRequest");
      expect(provider).toHaveProperty("buildChatCompletionsRequest");
    });
  });

  describe("endpoint property", () => {
    it("should have CohereEndpoint instance", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new Cohere();

      expect(provider.endpoint).toBeInstanceOf(MockCohereEndpoint);
    });
  });
});
