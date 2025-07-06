import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProviderNotSupportedError } from "~/src/providers/provider";
import { ReplicateEndpoint } from "~/src/providers/replicate/endpoint";
import { Replicate } from "~/src/providers/replicate/provider";
import * as Secrets from "~/src/utils/secrets";

vi.mock("~/src/utils/secrets");
vi.mock("~/src/providers/replicate/endpoint");

describe("Replicate Provider", () => {
  const mockSecretsGet = vi.fn();
  const MockReplicateEndpoint = vi.mocked(ReplicateEndpoint);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Secrets.Secrets.get).mockImplementation(mockSecretsGet);
  });

  describe("constructor", () => {
    it("should initialize with API key from secrets", () => {
      const testApiKey = "test_replicate_api_key";
      mockSecretsGet.mockReturnValue(testApiKey);

      const provider = new Replicate();

      expect(Secrets.Secrets.get).toHaveBeenCalledWith("REPLICATE_API_KEY");
      expect(MockReplicateEndpoint).toHaveBeenCalledWith(testApiKey);
      expect(provider.apiKeyName).toBe("REPLICATE_API_KEY");
    });

    it("should have empty paths since Replicate doesn't support standard endpoints", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new Replicate();

      expect(provider.chatCompletionPath).toBe("");
      expect(provider.modelsPath).toBe("");
    });
  });

  describe("buildChatCompletionsRequest", () => {
    it("should throw ProviderNotSupportedError", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new Replicate();

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
      }).toThrow("Replicate does not support chat completions");
    });
  });

  describe("buildModelsRequest", () => {
    it("should throw ProviderNotSupportedError", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new Replicate();

      expect(() => {
        provider.buildModelsRequest();
      }).toThrow(ProviderNotSupportedError);

      expect(() => {
        provider.buildModelsRequest();
      }).toThrow("Replicate does not support list models");
    });
  });

  describe("inheritance", () => {
    it("should extend ProviderBase", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new Replicate();

      expect(provider).toHaveProperty("available");
      expect(provider).toHaveProperty("buildModelsRequest");
      expect(provider).toHaveProperty("buildChatCompletionsRequest");
    });
  });

  describe("endpoint property", () => {
    it("should have ReplicateEndpoint instance", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new Replicate();

      expect(provider.endpoint).toBeInstanceOf(MockReplicateEndpoint);
    });
  });
});
