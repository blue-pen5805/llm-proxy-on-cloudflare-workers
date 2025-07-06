import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenAIEndpoint } from "~/src/providers/openai/endpoint";
import { OpenAI } from "~/src/providers/openai/provider";
import * as Secrets from "~/src/utils/secrets";

vi.mock("~/src/utils/secrets");
vi.mock("~/src/providers/openai/endpoint");

describe("OpenAI Provider", () => {
  const mockSecretsGet = vi.fn();
  const MockOpenAIEndpoint = vi.mocked(OpenAIEndpoint);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Secrets.Secrets.get).mockImplementation(mockSecretsGet);
  });

  describe("constructor", () => {
    it("should initialize with API key from secrets", () => {
      const testApiKey = "sk-test-api-key";
      mockSecretsGet.mockReturnValue(testApiKey);

      const provider = new OpenAI();

      expect(Secrets.Secrets.get).toHaveBeenCalledWith("OPENAI_API_KEY");
      expect(MockOpenAIEndpoint).toHaveBeenCalledWith(testApiKey);
      expect(provider.apiKeyName).toBe("OPENAI_API_KEY");
    });

    it("should initialize with undefined API key when not found", () => {
      mockSecretsGet.mockReturnValue(undefined);

      new OpenAI();

      expect(Secrets.Secrets.get).toHaveBeenCalledWith("OPENAI_API_KEY");
      expect(MockOpenAIEndpoint).toHaveBeenCalledWith(undefined);
    });
  });

  describe("inheritance", () => {
    it("should extend ProviderBase", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new OpenAI();

      expect(provider).toHaveProperty("chatCompletionPath");
      expect(provider).toHaveProperty("modelsPath");
      expect(provider).toHaveProperty("available");
      expect(provider).toHaveProperty("buildModelsRequest");
      expect(provider).toHaveProperty("buildChatCompletionsRequest");
    });
  });

  describe("endpoint property", () => {
    it("should have OpenAIEndpoint instance", () => {
      mockSecretsGet.mockReturnValue("test-key");
      const provider = new OpenAI();

      expect(provider.endpoint).toBeInstanceOf(MockOpenAIEndpoint);
    });
  });
});
