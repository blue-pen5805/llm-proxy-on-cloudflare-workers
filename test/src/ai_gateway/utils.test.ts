import { describe, it, expect } from "vitest";
import {
  isCloudflareAIGatewayProvider,
  isCloudflareAIGatewayOpenAICompatibleProvider,
} from "~/src/ai_gateway/utils";

describe("AI Gateway Utils", () => {
  describe("isCloudflareAIGatewayProvider", () => {
    it("should return true for valid AI Gateway providers", () => {
      expect(isCloudflareAIGatewayProvider("anthropic")).toBe(true);
      expect(isCloudflareAIGatewayProvider("openai")).toBe(true);
      expect(isCloudflareAIGatewayProvider("groq")).toBe(true);
      expect(isCloudflareAIGatewayProvider("mistral")).toBe(true);
      expect(isCloudflareAIGatewayProvider("cohere")).toBe(true);
      expect(isCloudflareAIGatewayProvider("perplexity-ai")).toBe(true);
      expect(isCloudflareAIGatewayProvider("workers-ai")).toBe(true);
      expect(isCloudflareAIGatewayProvider("google-ai-studio")).toBe(true);
      expect(isCloudflareAIGatewayProvider("grok")).toBe(true);
      expect(isCloudflareAIGatewayProvider("deepseek")).toBe(true);
      expect(isCloudflareAIGatewayProvider("cerebras")).toBe(true);
      expect(isCloudflareAIGatewayProvider("azure-openai")).toBe(true);
      expect(isCloudflareAIGatewayProvider("aws-bedrock")).toBe(true);
      expect(isCloudflareAIGatewayProvider("cartesia")).toBe(true);
      expect(isCloudflareAIGatewayProvider("elevenlabs")).toBe(true);
      expect(isCloudflareAIGatewayProvider("google-vertex-ai")).toBe(true);
      expect(isCloudflareAIGatewayProvider("huggingface")).toBe(true);
      expect(isCloudflareAIGatewayProvider("openrouter")).toBe(true);
      expect(isCloudflareAIGatewayProvider("replicate")).toBe(true);
    });

    it("should return false for invalid providers", () => {
      expect(isCloudflareAIGatewayProvider("invalid-provider")).toBe(false);
      expect(isCloudflareAIGatewayProvider("")).toBe(false);
      expect(isCloudflareAIGatewayProvider("custom-provider")).toBe(false);
    });
  });

  describe("isCloudflareAIGatewayOpenAICompatibleProvider", () => {
    it("should return true for OpenAI compatible providers", () => {
      expect(isCloudflareAIGatewayOpenAICompatibleProvider("anthropic")).toBe(
        true,
      );
      expect(isCloudflareAIGatewayOpenAICompatibleProvider("openai")).toBe(
        true,
      );
      expect(isCloudflareAIGatewayOpenAICompatibleProvider("groq")).toBe(true);
      expect(isCloudflareAIGatewayOpenAICompatibleProvider("mistral")).toBe(
        true,
      );
      expect(isCloudflareAIGatewayOpenAICompatibleProvider("cohere")).toBe(
        true,
      );
      expect(
        isCloudflareAIGatewayOpenAICompatibleProvider("perplexity-ai"),
      ).toBe(true);
      expect(isCloudflareAIGatewayOpenAICompatibleProvider("workers-ai")).toBe(
        true,
      );
      expect(
        isCloudflareAIGatewayOpenAICompatibleProvider("google-ai-studio"),
      ).toBe(true);
      expect(isCloudflareAIGatewayOpenAICompatibleProvider("grok")).toBe(true);
      expect(isCloudflareAIGatewayOpenAICompatibleProvider("deepseek")).toBe(
        true,
      );
      expect(isCloudflareAIGatewayOpenAICompatibleProvider("cerebras")).toBe(
        true,
      );
    });

    it("should return false for non-OpenAI compatible providers", () => {
      expect(
        isCloudflareAIGatewayOpenAICompatibleProvider("azure-openai"),
      ).toBe(false);
      expect(isCloudflareAIGatewayOpenAICompatibleProvider("aws-bedrock")).toBe(
        false,
      );
      expect(isCloudflareAIGatewayOpenAICompatibleProvider("cartesia")).toBe(
        false,
      );
      expect(isCloudflareAIGatewayOpenAICompatibleProvider("elevenlabs")).toBe(
        false,
      );
      expect(
        isCloudflareAIGatewayOpenAICompatibleProvider("google-vertex-ai"),
      ).toBe(false);
      expect(isCloudflareAIGatewayOpenAICompatibleProvider("huggingface")).toBe(
        false,
      );
      expect(isCloudflareAIGatewayOpenAICompatibleProvider("openrouter")).toBe(
        true,
      );
      expect(isCloudflareAIGatewayOpenAICompatibleProvider("replicate")).toBe(
        false,
      );
    });

    it("should return false for invalid providers", () => {
      expect(
        isCloudflareAIGatewayOpenAICompatibleProvider("invalid-provider"),
      ).toBe(false);
      expect(isCloudflareAIGatewayOpenAICompatibleProvider("")).toBe(false);
      expect(
        isCloudflareAIGatewayOpenAICompatibleProvider("custom-provider"),
      ).toBe(false);
    });
  });
});
