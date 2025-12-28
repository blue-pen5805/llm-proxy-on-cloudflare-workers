import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProviderNotSupportedError } from "~/src/providers/provider";
import { ReplicateEndpoint } from "~/src/providers/replicate/endpoint";
import { Replicate } from "~/src/providers/replicate/provider";

vi.mock("~/src/providers/replicate/endpoint");

describe("Replicate Provider", () => {
  const MockReplicateEndpoint = vi.mocked(ReplicateEndpoint);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with API key name", () => {
      const provider = new Replicate();
      expect(MockReplicateEndpoint).toHaveBeenCalledWith("REPLICATE_API_KEY");
      expect(provider.apiKeyName).toBe("REPLICATE_API_KEY");
    });

    it("should have empty paths since Replicate doesn't support standard endpoints", () => {
      const provider = new Replicate();
      expect(provider.chatCompletionPath).toBe("");
      expect(provider.modelsPath).toBe("");
    });
  });

  describe("buildChatCompletionsRequest", () => {
    it("should throw ProviderNotSupportedError", async () => {
      const provider = new Replicate();

      await expect(
        provider.buildChatCompletionsRequest({
          body: "{}",
          headers: {},
        }),
      ).rejects.toThrow(ProviderNotSupportedError);

      await expect(
        provider.buildChatCompletionsRequest({
          body: JSON.stringify({ stream: true }),
          headers: {},
        }),
      ).rejects.toThrow("Replicate does not support chat completions");
    });
  });

  describe("buildModelsRequest", () => {
    it("should throw ProviderNotSupportedError", async () => {
      const provider = new Replicate();

      await expect(provider.buildModelsRequest()).rejects.toThrow(
        ProviderNotSupportedError,
      );

      await expect(provider.buildModelsRequest()).rejects.toThrow(
        "Replicate does not support models list via this proxy.",
      );
    });
  });

  describe("inheritance", () => {
    it("should extend ProviderBase", () => {
      const provider = new Replicate();
      expect(provider).toHaveProperty("available");
      expect(provider).toHaveProperty("buildModelsRequest");
      expect(provider).toHaveProperty("buildChatCompletionsRequest");
    });
  });

  describe("endpoint property", () => {
    it("should have ReplicateEndpoint instance", () => {
      const provider = new Replicate();
      expect(provider.endpoint).toBeInstanceOf(MockReplicateEndpoint);
    });
  });
});
