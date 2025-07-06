import { describe, it, expect, vi, beforeEach } from "vitest";
import { CerebrasEndpoint } from "~/src/providers/cerebras/endpoint";
import { Cerebras } from "~/src/providers/cerebras/provider";
import type { OpenAIModelsListResponseBody } from "~/src/providers/openai/types";
import * as Secrets from "~/src/utils/secrets";

vi.mock("~/src/utils/secrets");
vi.mock("~/src/providers/cerebras/endpoint");

describe("Cerebras Provider", () => {
  const mockSecretsGet = vi.fn();
  const MockCerebrasEndpoint = vi.mocked(CerebrasEndpoint);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Secrets.Secrets.get).mockImplementation(mockSecretsGet);
  });

  describe("constructor", () => {
    it("should initialize with API key from secrets", () => {
      const testApiKey = "test_cerebras_api_key";
      mockSecretsGet.mockReturnValue(testApiKey);

      const provider = new Cerebras();

      expect(Secrets.Secrets.get).toHaveBeenCalledWith("CEREBRAS_API_KEY");
      expect(MockCerebrasEndpoint).toHaveBeenCalledWith(testApiKey);
      expect(provider.apiKeyName).toBe("CEREBRAS_API_KEY");
    });

    it("should have correct paths", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new Cerebras();

      expect(provider.chatCompletionPath).toBe("/chat/completions");
      expect(provider.modelsPath).toBe("/models");
    });
  });

  describe("CHAT_COMPLETIONS_SUPPORTED_PARAMETERS", () => {
    it("should have defined supported parameters", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new Cerebras();

      expect(provider.CHAT_COMPLETIONS_SUPPORTED_PARAMETERS).toContain(
        "messages",
      );
      expect(provider.CHAT_COMPLETIONS_SUPPORTED_PARAMETERS).toContain("model");
      expect(provider.CHAT_COMPLETIONS_SUPPORTED_PARAMETERS).toContain(
        "max_tokens",
      );
      expect(provider.CHAT_COMPLETIONS_SUPPORTED_PARAMETERS).toContain(
        "temperature",
      );
      expect(provider.CHAT_COMPLETIONS_SUPPORTED_PARAMETERS).toContain(
        "stream",
      );
    });
  });

  describe("modelsToOpenAIFormat", () => {
    it("should convert OpenAI models response to OpenAI format (passthrough)", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new Cerebras();

      const openaiResponse: OpenAIModelsListResponseBody = {
        object: "list",
        data: [
          {
            id: "llama3.1-8b",
            object: "model",
            created: 1699573300,
            owned_by: "cerebras",
          },
          {
            id: "llama3.1-70b",
            object: "model",
            created: 1699573300,
            owned_by: "cerebras",
          },
        ],
      };

      const result = provider.modelsToOpenAIFormat(openaiResponse);

      expect(result).toEqual({
        object: "list",
        data: [
          {
            id: "llama3.1-8b",
            object: "model",
            created: 1699573300,
            owned_by: "cerebras",
          },
          {
            id: "llama3.1-70b",
            object: "model",
            created: 1699573300,
            owned_by: "cerebras",
          },
        ],
      });
    });

    it("should handle empty models list", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new Cerebras();

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
      const provider = new Cerebras();

      expect(provider).toHaveProperty("available");
      expect(provider).toHaveProperty("buildModelsRequest");
      expect(provider).toHaveProperty("buildChatCompletionsRequest");
    });
  });

  describe("endpoint property", () => {
    it("should have CerebrasEndpoint instance", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new Cerebras();

      expect(provider.endpoint).toBeInstanceOf(MockCerebrasEndpoint);
    });
  });
});
