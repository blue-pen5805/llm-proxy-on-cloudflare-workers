import { describe, it, expect, vi, beforeEach } from "vitest";
import { GroqEndpoint } from "~/src/providers/groq/endpoint";
import { Groq } from "~/src/providers/groq/provider";
import type { GroqModelsListResponseBody } from "~/src/providers/groq/types";
import * as Secrets from "~/src/utils/secrets";

vi.mock("~/src/utils/secrets");
vi.mock("~/src/providers/groq/endpoint");

describe("Groq Provider", () => {
  const mockSecretsGet = vi.fn();
  const MockGroqEndpoint = vi.mocked(GroqEndpoint);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Secrets.Secrets.get).mockImplementation(mockSecretsGet);
  });

  describe("constructor", () => {
    it("should initialize with API key from secrets", () => {
      const testApiKey = "gsk_test_api_key";
      mockSecretsGet.mockReturnValue(testApiKey);

      const provider = new Groq();

      expect(Secrets.Secrets.get).toHaveBeenCalledWith("GROQ_API_KEY");
      expect(MockGroqEndpoint).toHaveBeenCalledWith(testApiKey);
      expect(provider.apiKeyName).toBe("GROQ_API_KEY");
    });
  });

  describe("modelsToOpenAIFormat", () => {
    it("should convert Groq models response to OpenAI format", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new Groq();

      const groqResponse: GroqModelsListResponseBody = {
        object: "list",
        data: [
          {
            id: "llama3-8b-8192",
            object: "model",
            created: 1693721698,
            owned_by: "Meta",
            active: true,
            context_window: 8192,
            public_apps: null,
          },
          {
            id: "mixtral-8x7b-32768",
            object: "model",
            created: 1693721698,
            owned_by: "Mistral AI",
            active: true,
            context_window: 32768,
            public_apps: null,
          },
        ],
      };

      const result = provider.modelsToOpenAIFormat(groqResponse);

      expect(result).toEqual({
        object: "list",
        data: [
          {
            id: "llama3-8b-8192",
            object: "model",
            created: 1693721698,
            owned_by: "Meta",
            _: {
              active: true,
              context_window: 8192,
              public_apps: null,
            },
          },
          {
            id: "mixtral-8x7b-32768",
            object: "model",
            created: 1693721698,
            owned_by: "Mistral AI",
            _: {
              active: true,
              context_window: 32768,
              public_apps: null,
            },
          },
        ],
      });
    });

    it("should handle empty models list", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new Groq();

      const groqResponse: GroqModelsListResponseBody = {
        object: "list",
        data: [],
      };

      const result = provider.modelsToOpenAIFormat(groqResponse);

      expect(result).toEqual({
        object: "list",
        data: [],
      });
    });
  });

  describe("inheritance", () => {
    it("should extend ProviderBase", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new Groq();

      expect(provider).toHaveProperty("chatCompletionPath");
      expect(provider).toHaveProperty("modelsPath");
      expect(provider).toHaveProperty("available");
      expect(provider).toHaveProperty("buildModelsRequest");
      expect(provider).toHaveProperty("buildChatCompletionsRequest");
    });
  });

  describe("endpoint property", () => {
    it("should have GroqEndpoint instance", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new Groq();

      expect(provider.endpoint).toBeInstanceOf(MockGroqEndpoint);
    });
  });
});
