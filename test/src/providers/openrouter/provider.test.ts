import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenRouterEndpoint } from "~/src/providers/openrouter/endpoint";
import { OpenRouter } from "~/src/providers/openrouter/provider";
import type { OpenRouterModelsListResponseBody } from "~/src/providers/openrouter/types";
import * as Secrets from "~/src/utils/secrets";

vi.mock("~/src/utils/secrets");
vi.mock("~/src/providers/openrouter/endpoint");

describe("OpenRouter Provider", () => {
  const mockSecretsGet = vi.fn();
  const MockOpenRouterEndpoint = vi.mocked(OpenRouterEndpoint);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Secrets.Secrets.get).mockImplementation(mockSecretsGet);
  });

  describe("constructor", () => {
    it("should initialize with API key from secrets", () => {
      const testApiKey = "test_openrouter_api_key";
      mockSecretsGet.mockReturnValue(testApiKey);

      const provider = new OpenRouter();

      expect(Secrets.Secrets.get).toHaveBeenCalledWith("OPENROUTER_API_KEY");
      expect(MockOpenRouterEndpoint).toHaveBeenCalledWith(testApiKey);
      expect(provider.apiKeyName).toBe("OPENROUTER_API_KEY");
    });

    it("should have correct paths", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new OpenRouter();

      expect(provider.chatCompletionPath).toBe("/v1/chat/completions");
      expect(provider.modelsPath).toBe("/v1/models");
    });
  });

  describe("modelsToOpenAIFormat", () => {
    it("should convert OpenRouter models response to OpenAI format", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new OpenRouter();

      const openRouterResponse: OpenRouterModelsListResponseBody = {
        object: "list",
        data: [
          {
            id: "openai/gpt-4o",
            name: "GPT-4o",
            created: 1699573300,
            description: "OpenAI's flagship model",
            pricing: {
              prompt: "0.000005",
              completion: "0.000015",
              image: "0.00765",
              request: "0",
            },
            context_length: 128000,
            architecture: {
              modality: "text+vision",
              tokenizer: "cl100k_base",
              instruct_type: "none",
            },
            top_provider: {
              context_length: 128000,
              max_completion_tokens: 4096,
              is_moderated: true,
            },
            per_request_limits: null,
          },
          {
            id: "anthropic/claude-3-sonnet",
            name: "Claude 3 Sonnet",
            created: 1699573300,
            description: "Anthropic's balanced model",
            pricing: {
              prompt: "0.000003",
              completion: "0.000015",
              image: "0.0048",
              request: "0",
            },
            context_length: 200000,
            architecture: {
              modality: "text+vision",
              tokenizer: "claude",
              instruct_type: "none",
            },
            top_provider: {
              context_length: 200000,
              max_completion_tokens: 4096,
              is_moderated: true,
            },
            per_request_limits: null,
          },
        ],
      };

      const result = provider.modelsToOpenAIFormat(openRouterResponse);

      expect(result).toEqual({
        object: "list",
        data: [
          {
            id: "openai/gpt-4o",
            object: "model",
            created: expect.any(Number),
            owned_by: "openrouter",
            _: {
              name: "GPT-4o",
              description: "OpenAI's flagship model",
              pricing: {
                prompt: "0.000005",
                completion: "0.000015",
                image: "0.00765",
                request: "0",
              },
              context_length: 128000,
              architecture: {
                modality: "text+vision",
                tokenizer: "cl100k_base",
                instruct_type: "none",
              },
              top_provider: {
                context_length: 128000,
                max_completion_tokens: 4096,
                is_moderated: true,
              },
              per_request_limits: null,
            },
          },
          {
            id: "anthropic/claude-3-sonnet",
            object: "model",
            created: 1699573300,
            owned_by: "openrouter",
            _: {
              name: "Claude 3 Sonnet",
              description: "Anthropic's balanced model",
              pricing: {
                prompt: "0.000003",
                completion: "0.000015",
                image: "0.0048",
                request: "0",
              },
              context_length: 200000,
              architecture: {
                modality: "text+vision",
                tokenizer: "claude",
                instruct_type: "none",
              },
              top_provider: {
                context_length: 200000,
                max_completion_tokens: 4096,
                is_moderated: true,
              },
              per_request_limits: null,
            },
          },
        ],
      });
    });

    it("should handle empty models list", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new OpenRouter();

      const openRouterResponse: OpenRouterModelsListResponseBody = {
        object: "list",
        data: [],
      };

      const result = provider.modelsToOpenAIFormat(openRouterResponse);

      expect(result).toEqual({
        object: "list",
        data: [],
      });
    });
  });

  describe("inheritance", () => {
    it("should extend ProviderBase", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new OpenRouter();

      expect(provider).toHaveProperty("available");
      expect(provider).toHaveProperty("buildModelsRequest");
      expect(provider).toHaveProperty("buildChatCompletionsRequest");
    });
  });

  describe("endpoint property", () => {
    it("should have OpenRouterEndpoint instance", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new OpenRouter();

      expect(provider.endpoint).toBeInstanceOf(MockOpenRouterEndpoint);
    });
  });
});
