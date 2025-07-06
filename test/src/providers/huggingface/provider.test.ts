import { describe, it, expect, vi, beforeEach } from "vitest";
import { HuggingFaceEndpoint } from "~/src/providers/huggingface/endpoint";
import { HuggingFace } from "~/src/providers/huggingface/provider";
import { ProviderNotSupportedError } from "~/src/providers/provider";
import * as Secrets from "~/src/utils/secrets";

vi.mock("~/src/utils/secrets");
vi.mock("~/src/providers/huggingface/endpoint");

describe("HuggingFace Provider", () => {
  const mockSecretsGet = vi.fn();
  const MockHuggingFaceEndpoint = vi.mocked(HuggingFaceEndpoint);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Secrets.Secrets.get).mockImplementation(mockSecretsGet);
  });

  describe("constructor", () => {
    it("should initialize with API key from secrets", () => {
      const testApiKey = "test_huggingface_api_key";
      mockSecretsGet.mockReturnValue(testApiKey);

      const provider = new HuggingFace();

      expect(Secrets.Secrets.get).toHaveBeenCalledWith("HUGGINGFACE_API_KEY");
      expect(MockHuggingFaceEndpoint).toHaveBeenCalledWith(testApiKey);
      expect(provider.apiKeyName).toBe("HUGGINGFACE_API_KEY");
    });

    it("should have empty paths since HuggingFace doesn't support standard endpoints", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new HuggingFace();

      expect(provider.chatCompletionPath).toBe("");
      expect(provider.modelsPath).toBe("");
    });
  });

  describe("buildChatCompletionsRequest", () => {
    it("should throw ProviderNotSupportedError", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new HuggingFace();

      expect(() => {
        provider.buildChatCompletionsRequest({
          body: "{}",
          headers: {},
        });
      }).toThrow(ProviderNotSupportedError);

      expect(() => {
        provider.buildChatCompletionsRequest({
          body: "{}",
          headers: {},
        });
      }).toThrow("HuggingFace does not support chat completions");
    });
  });

  describe("buildModelsRequest", () => {
    it("should throw ProviderNotSupportedError", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new HuggingFace();

      expect(() => {
        provider.buildModelsRequest();
      }).toThrow(ProviderNotSupportedError);

      expect(() => {
        provider.buildModelsRequest();
      }).toThrow("HuggingFace does not support list models");
    });
  });

  describe("inheritance", () => {
    it("should extend ProviderBase", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new HuggingFace();

      expect(provider).toHaveProperty("available");
      expect(provider).toHaveProperty("buildModelsRequest");
      expect(provider).toHaveProperty("buildChatCompletionsRequest");
    });
  });

  describe("endpoint property", () => {
    it("should have HuggingFaceEndpoint instance", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new HuggingFace();

      expect(provider.endpoint).toBeInstanceOf(MockHuggingFaceEndpoint);
    });
  });
});
