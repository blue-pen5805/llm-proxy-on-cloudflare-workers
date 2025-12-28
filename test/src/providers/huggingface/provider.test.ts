import { describe, it, expect, vi, beforeEach } from "vitest";
import { HuggingFaceEndpoint } from "~/src/providers/huggingface/endpoint";
import { HuggingFace } from "~/src/providers/huggingface/provider";
import { ProviderNotSupportedError } from "~/src/providers/provider";

vi.mock("~/src/providers/huggingface/endpoint");

describe("HuggingFace Provider", () => {
  const MockHuggingFaceEndpoint = vi.mocked(HuggingFaceEndpoint);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with API key name", () => {
      const provider = new HuggingFace();
      expect(MockHuggingFaceEndpoint).toHaveBeenCalledWith(
        "HUGGINGFACE_API_KEY",
      );
      expect(provider.apiKeyName).toBe("HUGGINGFACE_API_KEY");
    });

    it("should have correct paths", () => {
      const provider = new HuggingFace();
      expect(provider.chatCompletionPath).toBe("");
      expect(provider.modelsPath).toBe("");
    });
  });

  describe("buildChatCompletionsRequest", () => {
    it("should throw ProviderNotSupportedError", async () => {
      const provider = new HuggingFace();

      await expect(
        provider.buildChatCompletionsRequest({
          body: "{}",
          headers: {},
        }),
      ).rejects.toThrow(ProviderNotSupportedError);

      await expect(
        provider.buildChatCompletionsRequest({
          body: "{}",
          headers: {},
        }),
      ).rejects.toThrow("HuggingFace does not support chat completions");
    });
  });

  describe("buildModelsRequest", () => {
    it("should throw ProviderNotSupportedError", async () => {
      const provider = new HuggingFace();

      await expect(provider.buildModelsRequest()).rejects.toThrow(
        ProviderNotSupportedError,
      );

      await expect(provider.buildModelsRequest()).rejects.toThrow(
        "HuggingFace does not support models list via this proxy.",
      );
    });
  });

  describe("inheritance", () => {
    it("should extend ProviderBase", () => {
      const provider = new HuggingFace();
      expect(provider).toHaveProperty("available");
      expect(provider).toHaveProperty("buildModelsRequest");
      expect(provider).toHaveProperty("buildChatCompletionsRequest");
    });
  });

  describe("endpoint property", () => {
    it("should have HuggingFaceEndpoint instance", () => {
      const provider = new HuggingFace();
      expect(provider.endpoint).toBeInstanceOf(MockHuggingFaceEndpoint);
    });
  });
});
