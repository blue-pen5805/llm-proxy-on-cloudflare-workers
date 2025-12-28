import { describe, it, expect, vi, beforeEach } from "vitest";
import { GoogleAiStudioEndpoint } from "~/src/providers/google-ai-studio/endpoint";
import { GoogleAiStudio } from "~/src/providers/google-ai-studio/provider";
import type { GoogleAiStudioModelsListResponseBody } from "~/src/providers/google-ai-studio/types";
import * as Secrets from "~/src/utils/secrets";

vi.mock("~/src/utils/secrets");
vi.mock("~/src/providers/google-ai-studio/endpoint");

describe("GoogleAiStudio Provider", () => {
  const MockGoogleAiStudioEndpoint = vi.mocked(GoogleAiStudioEndpoint);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with API key name", () => {
      const provider = new GoogleAiStudio();

      expect(provider.apiKeyName).toBe("GEMINI_API_KEY");
      expect(MockGoogleAiStudioEndpoint).toHaveBeenCalledWith("GEMINI_API_KEY");
    });

    it("should have correct paths", () => {
      const provider = new GoogleAiStudio();

      expect(provider.chatCompletionPath).toBe(
        "/v1beta/openai/chat/completions",
      );
      expect(provider.modelsPath).toBe("/v1beta/models");
    });
  });

  describe("modelsToOpenAIFormat", () => {
    it("should convert Google AI Studio models response to OpenAI format", () => {
      const provider = new GoogleAiStudio();

      const googleResponse: GoogleAiStudioModelsListResponseBody = {
        models: [
          {
            name: "models/gemini-pro",
            displayName: "Gemini Pro",
            description:
              "The best model for scaling across a wide range of tasks",
            version: "001",
            inputTokenLimit: 30720,
            outputTokenLimit: 2048,
            supportedGenerationMethods: ["generateContent", "countTokens"],
            temperature: 0.9,
            topP: 1,
            topK: 1,
          },
          {
            name: "models/gemini-pro-vision",
            displayName: "Gemini Pro Vision",
            description:
              "The best image understanding model to handle a broad range of applications",
            version: "001",
            inputTokenLimit: 12288,
            outputTokenLimit: 4096,
            supportedGenerationMethods: ["generateContent", "countTokens"],
            temperature: 0.4,
            topP: 1,
            topK: 32,
          },
        ],
      };

      const result = provider.modelsToOpenAIFormat(googleResponse);

      expect(result).toEqual({
        object: "list",
        data: [
          {
            id: "gemini-pro",
            object: "model",
            created: expect.any(Number),
            owned_by: "google_ai_studio",
            _: {
              displayName: "Gemini Pro",
              description:
                "The best model for scaling across a wide range of tasks",
              version: "001",
              inputTokenLimit: 30720,
              outputTokenLimit: 2048,
              supportedGenerationMethods: ["generateContent", "countTokens"],
              temperature: 0.9,
              topP: 1,
              topK: 1,
            },
          },
          {
            id: "gemini-pro-vision",
            object: "model",
            created: expect.any(Number),
            owned_by: "google_ai_studio",
            _: {
              displayName: "Gemini Pro Vision",
              description:
                "The best image understanding model to handle a broad range of applications",
              version: "001",
              inputTokenLimit: 12288,
              outputTokenLimit: 4096,
              supportedGenerationMethods: ["generateContent", "countTokens"],
              temperature: 0.4,
              topP: 1,
              topK: 32,
            },
          },
        ],
      });
    });

    it("should handle empty models list", () => {
      const provider = new GoogleAiStudio();

      const googleResponse: GoogleAiStudioModelsListResponseBody = {
        models: [],
      };

      const result = provider.modelsToOpenAIFormat(googleResponse);

      expect(result).toEqual({
        object: "list",
        data: [],
      });
    });
  });

  describe("inheritance", () => {
    it("should extend ProviderBase", () => {
      const provider = new GoogleAiStudio();

      expect(provider).toHaveProperty("available");
      expect(provider).toHaveProperty("buildModelsRequest");
      expect(provider).toHaveProperty("buildChatCompletionsRequest");
    });
  });

  describe("endpoint property", () => {
    it("should have GoogleAiStudioEndpoint instance", () => {
      const provider = new GoogleAiStudio();

      expect(provider.endpoint).toBeInstanceOf(MockGoogleAiStudioEndpoint);
    });
  });
});
