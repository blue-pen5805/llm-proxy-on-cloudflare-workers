import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkersAiEndpoint } from "~/src/providers/workers_ai/endpoint";
import { WorkersAi } from "~/src/providers/workers_ai/provider";
import type { WorkersAiModelsListResponseBody } from "~/src/providers/workers_ai/types";
import * as Secrets from "~/src/utils/secrets";

vi.mock("~/src/utils/secrets");
vi.mock("~/src/providers/workers_ai/endpoint");

describe("WorkersAi Provider", () => {
  const MockWorkersAiEndpoint = vi.mocked(WorkersAiEndpoint);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with API key and account ID names", () => {
      const provider = new WorkersAi();

      expect(provider.apiKeyName).toBe("CLOUDFLARE_API_KEY");
      expect(provider.accountIdName).toBe("CLOUDFLARE_ACCOUNT_ID");
      expect(MockWorkersAiEndpoint).toHaveBeenCalledWith(
        "CLOUDFLARE_API_KEY",
        "CLOUDFLARE_ACCOUNT_ID",
      );
    });

    it("should have correct paths", () => {
      const provider = new WorkersAi();

      expect(provider.chatCompletionPath).toBe("/v1/chat/completions");
      expect(provider.modelsPath).toBe("/models/search?task=Text Generation");
    });
  });

  describe("modelsToOpenAIFormat", () => {
    it("should convert Workers AI models response to OpenAI format", () => {
      const provider = new WorkersAi();

      const workersAiResponse: WorkersAiModelsListResponseBody = {
        success: true,
        result: [
          {
            id: "model1",
            source: 1,
            name: "@cf/meta/llama-2-7b-chat-int8",
            description: "A chat model",
            task: {
              id: "text-generation",
              name: "Text Generation",
              description: "Generate text",
            },
            tags: ["chat", "text"],
            propertis: [
              {
                property_id: "max_tokens",
                value: "4096",
              },
            ],
          },
          {
            id: "model2",
            source: 1,
            name: "@cf/microsoft/dialoGPT-medium",
            description: "Another chat model",
            task: {
              id: "text-generation",
              name: "Text Generation",
              description: "Generate text",
            },
            tags: ["chat"],
            propertis: [],
          },
        ],
        errors: [],
        messages: [],
        result_info: {
          count: 2,
          page: 1,
          per_page: 10,
          total_count: 2,
        },
      };

      const result = provider.modelsToOpenAIFormat(workersAiResponse);

      expect(result).toEqual({
        object: "list",
        data: [
          {
            id: "@cf/meta/llama-2-7b-chat-int8",
            object: "model",
            created: 0,
            owned_by: "workers_ai",
            _: {
              id: "model1",
              source: 1,
              description: "A chat model",
              task: {
                id: "text-generation",
                name: "Text Generation",
                description: "Generate text",
              },
              tags: ["chat", "text"],
              propertis: [
                {
                  property_id: "max_tokens",
                  value: "4096",
                },
              ],
            },
          },
          {
            id: "@cf/microsoft/dialoGPT-medium",
            object: "model",
            created: 0,
            owned_by: "workers_ai",
            _: {
              id: "model2",
              source: 1,
              description: "Another chat model",
              task: {
                id: "text-generation",
                name: "Text Generation",
                description: "Generate text",
              },
              tags: ["chat"],
              propertis: [],
            },
          },
        ],
      });
    });

    it("should handle empty models list", () => {
      const provider = new WorkersAi();

      const workersAiResponse: WorkersAiModelsListResponseBody = {
        success: true,
        result: [],
        errors: [],
        messages: [],
        result_info: {
          count: 0,
          page: 1,
          per_page: 10,
          total_count: 0,
        },
      };

      const result = provider.modelsToOpenAIFormat(workersAiResponse);

      expect(result).toEqual({
        object: "list",
        data: [],
      });
    });
  });

  describe("inheritance", () => {
    it("should extend ProviderBase", () => {
      const provider = new WorkersAi();

      expect(provider).toHaveProperty("available");
      expect(provider).toHaveProperty("buildModelsRequest");
      expect(provider).toHaveProperty("buildChatCompletionsRequest");
    });
  });

  describe("endpoint property", () => {
    it("should have WorkersAiEndpoint instance", () => {
      const provider = new WorkersAi();

      expect(provider.endpoint).toBeInstanceOf(MockWorkersAiEndpoint);
    });
  });
});
