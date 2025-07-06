import { describe, it, expect, vi, beforeEach } from "vitest";
import { DeepSeekEndpoint } from "~/src/providers/deepseek/endpoint";
import { DeepSeek } from "~/src/providers/deepseek/provider";
import type { DeepSeekModelsListResponseBody } from "~/src/providers/deepseek/types";
import * as Secrets from "~/src/utils/secrets";

vi.mock("~/src/utils/secrets");
vi.mock("~/src/providers/deepseek/endpoint");

describe("DeepSeek Provider", () => {
  const mockSecretsGet = vi.fn();
  const MockDeepSeekEndpoint = vi.mocked(DeepSeekEndpoint);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Secrets.Secrets.get).mockImplementation(mockSecretsGet);
  });

  describe("constructor", () => {
    it("should initialize with API key from secrets", () => {
      const testApiKey = "test_deepseek_api_key";
      mockSecretsGet.mockReturnValue(testApiKey);

      const provider = new DeepSeek();

      expect(Secrets.Secrets.get).toHaveBeenCalledWith("DEEPSEEK_API_KEY");
      expect(MockDeepSeekEndpoint).toHaveBeenCalledWith(testApiKey);
      expect(provider.apiKeyName).toBe("DEEPSEEK_API_KEY");
    });

    it("should have correct paths", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new DeepSeek();

      expect(provider.chatCompletionPath).toBe("/chat/completions");
      expect(provider.modelsPath).toBe("/models");
    });
  });

  describe("modelsToOpenAIFormat", () => {
    it("should convert DeepSeek models response to OpenAI format", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new DeepSeek();

      const deepseekResponse: DeepSeekModelsListResponseBody = {
        object: "list",
        data: [
          {
            id: "deepseek-chat",
            object: "model",
            created: 1640995200,
            owned_by: "deepseek",
          },
          {
            id: "deepseek-coder",
            object: "model",
            created: 1640995200,
            owned_by: "deepseek",
          },
        ],
      };

      const result = provider.modelsToOpenAIFormat(deepseekResponse);

      expect(result).toEqual({
        object: "list",
        data: [
          {
            id: "deepseek-chat",
            object: "model",
            created: 1640995200,
            owned_by: "deepseek",
          },
          {
            id: "deepseek-coder",
            object: "model",
            created: 1640995200,
            owned_by: "deepseek",
          },
        ],
      });
    });

    it("should handle empty models list", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new DeepSeek();

      const deepseekResponse: DeepSeekModelsListResponseBody = {
        object: "list",
        data: [],
      };

      const result = provider.modelsToOpenAIFormat(deepseekResponse);

      expect(result).toEqual({
        object: "list",
        data: [],
      });
    });
  });

  describe("inheritance", () => {
    it("should extend ProviderBase", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new DeepSeek();

      expect(provider).toHaveProperty("available");
      expect(provider).toHaveProperty("buildModelsRequest");
      expect(provider).toHaveProperty("buildChatCompletionsRequest");
    });
  });

  describe("endpoint property", () => {
    it("should have DeepSeekEndpoint instance", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new DeepSeek();

      expect(provider.endpoint).toBeInstanceOf(MockDeepSeekEndpoint);
    });
  });
});
