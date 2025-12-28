import { describe, it, expect, vi, beforeEach } from "vitest";
import { GrokEndpoint } from "~/src/providers/grok/endpoint";
import { Grok } from "~/src/providers/grok/provider";

vi.mock("~/src/providers/grok/endpoint");

describe("Grok Provider", () => {
  const MockGrokEndpoint = vi.mocked(GrokEndpoint);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with API key name", () => {
      const provider = new Grok();
      expect(MockGrokEndpoint).toHaveBeenCalledWith("GROK_API_KEY");
      expect(provider.apiKeyName).toBe("GROK_API_KEY");
    });

    it("should have correct paths", () => {
      const provider = new Grok();
      expect(provider.chatCompletionPath).toBe("/v1/chat/completions");
      expect(provider.modelsPath).toBe("/v1/models");
    });
  });

  describe("inheritance", () => {
    it("should extend ProviderBase", () => {
      const provider = new Grok();
      expect(provider).toHaveProperty("available");
      expect(provider).toHaveProperty("buildModelsRequest");
      expect(provider).toHaveProperty("buildChatCompletionsRequest");
    });
  });

  describe("endpoint property", () => {
    it("should have GrokEndpoint instance", () => {
      const provider = new Grok();
      expect(provider.endpoint).toBeInstanceOf(MockGrokEndpoint);
    });
  });
});
