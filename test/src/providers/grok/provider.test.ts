import { describe, it, expect, vi, beforeEach } from "vitest";
import { GrokEndpoint } from "~/src/providers/grok/endpoint";
import { Grok } from "~/src/providers/grok/provider";
import type { GrokModelsListResponseBody } from "~/src/providers/grok/types";
import * as Secrets from "~/src/utils/secrets";

vi.mock("~/src/utils/secrets");
vi.mock("~/src/providers/grok/endpoint");

describe("Grok Provider", () => {
  const mockSecretsGet = vi.fn();
  const MockGrokEndpoint = vi.mocked(GrokEndpoint);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Secrets.Secrets.get).mockImplementation(mockSecretsGet);
  });

  describe("constructor", () => {
    it("should initialize with API key from secrets", () => {
      const testApiKey = "test_grok_api_key";
      mockSecretsGet.mockReturnValue(testApiKey);

      const provider = new Grok();

      expect(Secrets.Secrets.get).toHaveBeenCalledWith("GROK_API_KEY");
      expect(MockGrokEndpoint).toHaveBeenCalledWith(testApiKey);
      expect(provider.apiKeyName).toBe("GROK_API_KEY");
    });

    it("should have correct paths", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new Grok();

      expect(provider.chatCompletionPath).toBe("/v1/chat/completions");
      expect(provider.modelsPath).toBe("/v1/models");
    });
  });

  describe("modelsToOpenAIFormat", () => {
    it("should convert Grok models response to OpenAI format", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new Grok();

      const grokResponse: GrokModelsListResponseBody = {
        object: "list",
        data: [
          {
            id: "grok-beta",
            object: "model",
            created: 1699573300,
            owned_by: "xai",
          },
          {
            id: "grok-vision-beta",
            object: "model",
            created: 1699573300,
            owned_by: "xai",
          },
        ],
      };

      const result = provider.modelsToOpenAIFormat(grokResponse);

      expect(result).toEqual({
        object: "list",
        data: [
          {
            id: "grok-beta",
            object: "model",
            created: 1699573300,
            owned_by: "xai",
          },
          {
            id: "grok-vision-beta",
            object: "model",
            created: 1699573300,
            owned_by: "xai",
          },
        ],
      });
    });

    it("should handle empty models list", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new Grok();

      const grokResponse: GrokModelsListResponseBody = {
        object: "list",
        data: [],
      };

      const result = provider.modelsToOpenAIFormat(grokResponse);

      expect(result).toEqual({
        object: "list",
        data: [],
      });
    });
  });

  describe("inheritance", () => {
    it("should extend ProviderBase", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new Grok();

      expect(provider).toHaveProperty("available");
      expect(provider).toHaveProperty("buildModelsRequest");
      expect(provider).toHaveProperty("buildChatCompletionsRequest");
    });
  });

  describe("endpoint property", () => {
    it("should have GrokEndpoint instance", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new Grok();

      expect(provider.endpoint).toBeInstanceOf(MockGrokEndpoint);
    });
  });
});
