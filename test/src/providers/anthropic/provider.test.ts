import { describe, it, expect, vi, beforeEach } from "vitest";
import { AnthropicEndpoint } from "~/src/providers/anthropic/endpoint";
import { Anthropic } from "~/src/providers/anthropic/provider";
import type { AnthropicModelsListResponseBody } from "~/src/providers/anthropic/types";
import * as Secrets from "~/src/utils/secrets";

vi.mock("~/src/utils/secrets");
vi.mock("~/src/providers/anthropic/endpoint");

describe("Anthropic Provider", () => {
  const mockSecretsGet = vi.fn();
  const MockAnthropicEndpoint = vi.mocked(AnthropicEndpoint);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Secrets.Secrets.get).mockImplementation(mockSecretsGet);
  });

  describe("constructor", () => {
    it("should initialize with API key from secrets", () => {
      const testApiKey = "sk-ant-test-api-key";
      mockSecretsGet.mockReturnValue(testApiKey);

      const provider = new Anthropic();

      expect(Secrets.Secrets.get).toHaveBeenCalledWith("ANTHROPIC_API_KEY");
      expect(MockAnthropicEndpoint).toHaveBeenCalledWith(testApiKey);
      expect(provider.apiKeyName).toBe("ANTHROPIC_API_KEY");
    });

    it("should have correct paths", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new Anthropic();

      expect(provider.chatCompletionPath).toBe("/v1/chat/completions");
      expect(provider.modelsPath).toBe("/v1/models");
    });
  });

  describe("modelsToOpenAIFormat", () => {
    it("should convert Anthropic models response to OpenAI format", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new Anthropic();

      const anthropicResponse: AnthropicModelsListResponseBody = {
        data: [
          {
            type: "model",
            id: "claude-3-opus-20240229",
            display_name: "Claude 3 Opus",
            created_at: "2024-02-29T00:00:00.000Z",
          },
          {
            type: "model",
            id: "claude-3-sonnet-20240229",
            display_name: "Claude 3 Sonnet",
            created_at: "2024-02-29T00:00:00.000Z",
          },
        ],
        has_more: false,
        first_id: "claude-3-opus-20240229",
        last_id: "claude-3-sonnet-20240229",
      };

      const result = provider.modelsToOpenAIFormat(anthropicResponse);

      expect(result).toEqual({
        object: "list",
        data: [
          {
            id: "claude-3-opus-20240229",
            object: "model",
            created: 1709164800,
            owned_by: "anthropic",
            _: {
              display_name: "Claude 3 Opus",
            },
          },
          {
            id: "claude-3-sonnet-20240229",
            object: "model",
            created: 1709164800,
            owned_by: "anthropic",
            _: {
              display_name: "Claude 3 Sonnet",
            },
          },
        ],
      });
    });

    it("should handle empty models list", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new Anthropic();

      const anthropicResponse: AnthropicModelsListResponseBody = {
        data: [],
        has_more: false,
        first_id: "",
        last_id: "",
      };

      const result = provider.modelsToOpenAIFormat(anthropicResponse);

      expect(result).toEqual({
        object: "list",
        data: [],
      });
    });
  });

  describe("inheritance", () => {
    it("should extend ProviderBase", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new Anthropic();

      expect(provider).toHaveProperty("available");
      expect(provider).toHaveProperty("buildModelsRequest");
      expect(provider).toHaveProperty("buildChatCompletionsRequest");
    });
  });

  describe("endpoint property", () => {
    it("should have AnthropicEndpoint instance", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new Anthropic();

      expect(provider.endpoint).toBeInstanceOf(MockAnthropicEndpoint);
    });
  });
});
