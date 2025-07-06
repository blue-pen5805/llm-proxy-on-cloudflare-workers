import { describe, it, expect, vi, beforeEach } from "vitest";
import { MistralEndpoint } from "~/src/providers/mistral/endpoint";
import { Mistral } from "~/src/providers/mistral/provider";
import type { MistralModelsListResponseBody } from "~/src/providers/mistral/types";
import * as Secrets from "~/src/utils/secrets";

vi.mock("~/src/utils/secrets");
vi.mock("~/src/providers/mistral/endpoint");

describe("Mistral Provider", () => {
  const mockSecretsGet = vi.fn();
  const MockMistralEndpoint = vi.mocked(MistralEndpoint);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Secrets.Secrets.get).mockImplementation(mockSecretsGet);
  });

  describe("constructor", () => {
    it("should initialize with API key from secrets", () => {
      const testApiKey = "test_mistral_api_key";
      mockSecretsGet.mockReturnValue(testApiKey);

      const provider = new Mistral();

      expect(Secrets.Secrets.get).toHaveBeenCalledWith("MISTRAL_API_KEY");
      expect(MockMistralEndpoint).toHaveBeenCalledWith(testApiKey);
      expect(provider.apiKeyName).toBe("MISTRAL_API_KEY");
    });

    it("should have correct paths", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new Mistral();

      expect(provider.chatCompletionPath).toBe("/v1/chat/completions");
      expect(provider.modelsPath).toBe("/v1/models");
    });
  });

  describe("modelsToOpenAIFormat", () => {
    it("should convert Mistral models response to OpenAI format", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new Mistral();

      const mistralResponse: MistralModelsListResponseBody = {
        object: "list",
        data: [
          {
            id: "mistral-tiny",
            object: "model",
            created: 1687579930,
            owned_by: "mistralai",
            capabilities: {
              completion_chat: true,
              completion_fim: false,
              function_calling: true,
              fine_tuning: false,
              vision: false,
            },
            name: "Mistral 7B",
            description: "A 7B model for fast inference",
            max_context_length: 32768,
            aliases: ["mistral-7b"],
            deprecation: null,
            default_model_temperature: 0.7,
            type: "base",
          },
          {
            id: "mistral-small",
            object: "model",
            created: 1687579930,
            owned_by: "mistralai",
            capabilities: {
              completion_chat: true,
              completion_fim: false,
              function_calling: true,
              fine_tuning: false,
              vision: false,
            },
            name: "Mistral Small",
            description: "A small model for cost-effective inference",
            max_context_length: 32768,
            aliases: ["mistral-small-latest"],
            deprecation: null,
            default_model_temperature: 0.7,
            type: "base",
          },
        ],
      };

      const result = provider.modelsToOpenAIFormat(mistralResponse);

      expect(result).toEqual({
        object: "list",
        data: [
          {
            id: "mistral-tiny",
            object: "model",
            created: 1687579930,
            owned_by: "mistralai",
            _: {
              capabilities: {
                completion_chat: true,
                completion_fim: false,
                function_calling: true,
                fine_tuning: false,
                vision: false,
              },
              name: "Mistral 7B",
              description: "A 7B model for fast inference",
              max_context_length: 32768,
              aliases: ["mistral-7b"],
              deprecation: null,
              default_model_temperature: 0.7,
              type: "base",
            },
          },
          {
            id: "mistral-small",
            object: "model",
            created: 1687579930,
            owned_by: "mistralai",
            _: {
              capabilities: {
                completion_chat: true,
                completion_fim: false,
                function_calling: true,
                fine_tuning: false,
                vision: false,
              },
              name: "Mistral Small",
              description: "A small model for cost-effective inference",
              max_context_length: 32768,
              aliases: ["mistral-small-latest"],
              deprecation: null,
              default_model_temperature: 0.7,
              type: "base",
            },
          },
        ],
      });
    });

    it("should handle empty models list", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new Mistral();

      const mistralResponse: MistralModelsListResponseBody = {
        object: "list",
        data: [],
      };

      const result = provider.modelsToOpenAIFormat(mistralResponse);

      expect(result).toEqual({
        object: "list",
        data: [],
      });
    });
  });

  describe("inheritance", () => {
    it("should extend ProviderBase", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new Mistral();

      expect(provider).toHaveProperty("available");
      expect(provider).toHaveProperty("buildModelsRequest");
      expect(provider).toHaveProperty("buildChatCompletionsRequest");
    });
  });

  describe("endpoint property", () => {
    it("should have MistralEndpoint instance", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new Mistral();

      expect(provider.endpoint).toBeInstanceOf(MockMistralEndpoint);
    });
  });
});
