import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Anthropic } from "~/src/providers/anthropic/provider";
import { Cohere } from "~/src/providers/cohere/provider";
import { CustomOpenAI } from "~/src/providers/custom-openai";
import { GoogleAiStudio } from "~/src/providers/google-ai-studio/provider";
import { Grok } from "~/src/providers/grok/provider";
import { Groq } from "~/src/providers/groq/provider";
import { HuggingFace } from "~/src/providers/huggingface/provider";
import { Mistral } from "~/src/providers/mistral/provider";
import { OpenRouter } from "~/src/providers/openrouter/provider";
import { PerplexityAi } from "~/src/providers/perplexity-ai/provider";
import {
  OpenAICompatibleProvider,
  ProviderBase,
  ProviderNotSupportedError,
} from "~/src/providers/provider";
import { Replicate } from "~/src/providers/replicate/provider";
import { WorkersAi } from "~/src/providers/workers_ai/provider";
import { Secrets } from "~/src/utils/secrets";

describe("provider contracts", () => {
  beforeEach(() => {
    vi.spyOn(Secrets, "get").mockImplementation((name, index) =>
      name === "CLOUDFLARE_ACCOUNT_ID" ? "account-id" : `key-${index ?? 0}`,
    );
    vi.spyOn(Secrets, "getAll").mockReturnValue(["key-0", "key-1"]);
    vi.spyOn(Secrets, "getNext").mockResolvedValue(1);
    vi.spyOn(Secrets, "getNextIndex").mockResolvedValue(1);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("ProviderBase", () => {
    it("provides safe defaults for providers without credentials", async () => {
      const provider = new ProviderBase();

      expect(provider.available()).toBe(false);
      expect(provider.getApiKeys()).toEqual([]);
      expect(await provider.getNextApiKeyIndex()).toBe(0);
      expect(provider.baseUrl()).toBe("https://example.com");
      expect(provider.pathnamePrefix()).toBe("");
      expect(await provider.headers()).toEqual({});
      expect(provider.staticModels()).toBeUndefined();

      const models = { object: "list", data: [] } as const;
      expect(provider.modelsToOpenAIFormat(models)).toBe(models);
    });

    it("rotates configured credentials and merges request headers", async () => {
      class TestProvider extends ProviderBase {
        readonly apiKeyName: keyof Env = "OPENAI_API_KEY";
        readonly baseUrlProp = "https://api.example.test";
        readonly pathnamePrefixProp = "/v1";

        async headers(index?: number): Promise<HeadersInit> {
          return { Authorization: `Bearer key-${index ?? 0}` };
        }
      }

      const provider = new TestProvider();
      expect(provider.available()).toBe(true);
      expect(provider.getApiKeys()).toEqual(["key-0", "key-1"]);
      expect(await provider.getNextApiKeyIndex()).toBe(1);
      expect(Secrets.getNext).toHaveBeenCalledWith("OPENAI_API_KEY");

      await expect(
        provider.buildRequest(
          "/models",
          { method: "GET", headers: { Accept: "application/json" } },
          1,
        ),
      ).resolves.toEqual([
        "https://api.example.test/v1/models",
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: "Bearer key-1",
          },
        },
      ]);
    });

    it("does not rotate a single configured credential", async () => {
      class TestProvider extends ProviderBase {
        readonly apiKeyName: keyof Env = "OPENAI_API_KEY";
      }
      vi.mocked(Secrets.getAll).mockReturnValue(["only-key"]);

      expect(await new TestProvider().getNextApiKeyIndex()).toBe(0);
      expect(Secrets.getNext).not.toHaveBeenCalled();
    });

    it("falls back safely when a key source has no binding name", async () => {
      class ExternalKeyProvider extends ProviderBase {
        getApiKeys(): string[] {
          return ["first", "second"];
        }
      }

      expect(await new ExternalKeyProvider().getNextApiKeyIndex()).toBe(0);
    });

    it("builds filtered OpenAI-compatible requests", async () => {
      const provider = new ProviderBase();
      vi.spyOn(provider, "headers").mockResolvedValue({
        Authorization: "provider-header",
        "X-Provider": "kept",
      });

      const [chatPath, chatInit] = await provider.buildChatCompletionsRequest({
        body: JSON.stringify({
          model: "model-id",
          messages: [],
          temperature: 0.5,
          unsupported: "removed",
        }),
        headers: { Authorization: "caller-header" },
        apiKeyIndex: 1,
      });
      expect(chatPath).toBe("/chat/completions");
      expect(chatInit).toEqual({
        method: "POST",
        body: JSON.stringify({
          model: "model-id",
          messages: [],
          temperature: 0.5,
        }),
        headers: {
          Authorization: "caller-header",
          "X-Provider": "kept",
        },
      });

      await expect(provider.buildModelsRequest(1)).resolves.toEqual([
        "/models",
        {
          method: "GET",
          headers: {
            Authorization: "provider-header",
            "X-Provider": "kept",
          },
        },
      ]);
    });

    it("delegates fetch using the fully built request", async () => {
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response("proxied", { status: 202 }));
      const provider = new ProviderBase();

      const response = await provider.fetch("/resource", { method: "POST" });

      expect(fetchMock).toHaveBeenCalledWith("https://example.com/resource", {
        method: "POST",
        headers: {},
      });
      expect(response.status).toBe(202);
      expect(await response.text()).toBe("proxied");
    });
  });

  describe("OpenAI-compatible credentials", () => {
    it("omits authorization when no API key exists", async () => {
      vi.mocked(Secrets.getAll).mockReturnValue([]);
      expect(await new OpenAICompatibleProvider().headers()).toEqual({});
    });

    it("selects and wraps credential indexes", async () => {
      const provider = new OpenAICompatibleProvider();
      vi.spyOn(provider, "getApiKeys").mockReturnValue(["first", "second"]);

      await expect(provider.headers()).resolves.toEqual({
        "Content-Type": "application/json",
        Authorization: "Bearer first",
      });
      await expect(provider.headers(3)).resolves.toEqual({
        "Content-Type": "application/json",
        Authorization: "Bearer second",
      });
    });
  });

  describe("provider-specific behavior", () => {
    it.each([
      [new Anthropic(), "/v1/chat/completions", "/v1/models"],
      [
        new Cohere(),
        "/compatibility/v1/chat/completions",
        "/v1/models?page_size=100&endpoint=chat",
      ],
      [
        new GoogleAiStudio(),
        "/v1beta/openai/chat/completions",
        "/v1beta/models",
      ],
      [new Grok(), "/v1/chat/completions", "/v1/models"],
      [new HuggingFace(), "", ""],
      [new Mistral(), "/v1/chat/completions", "/v1/models"],
      [new OpenRouter(), "/v1/chat/completions", "/v1/models"],
      [new PerplexityAi(), "/v1/chat/completions", "/v1/models"],
      [new Replicate(), "", ""],
      [
        new WorkersAi(),
        "/v1/chat/completions",
        "/models/search?task=Text Generation",
      ],
    ])(
      "exposes the expected endpoint paths for %s",
      (provider, chat, models) => {
        expect(provider.chatCompletionPath).toBe(chat);
        expect(provider.modelsPath).toBe(models);
      },
    );

    it("builds Anthropic headers and converts model timestamps", async () => {
      const provider = new Anthropic();
      await expect(provider.headers(1)).resolves.toEqual({
        "Content-Type": "application/json",
        "x-api-key": "key-1",
        "anthropic-version": "2023-06-01",
      });
      expect(
        provider.modelsToOpenAIFormat({
          data: [
            {
              id: "claude",
              type: "model",
              created_at: "2024-01-01T00:00:00.000Z",
              display_name: "Claude",
            },
          ],
          first_id: "claude",
          has_more: false,
          last_id: "claude",
        }),
      ).toEqual({
        object: "list",
        data: [
          {
            id: "claude",
            object: "model",
            created: 1704067200,
            owned_by: "anthropic",
            _: { display_name: "Claude" },
          },
        ],
      });
    });

    it("converts provider model lists to the common format", () => {
      expect(
        new Cohere().modelsToOpenAIFormat({
          models: [{ name: "command", endpoints: ["chat"] }],
          next_page_token: null,
        }),
      ).toEqual({
        object: "list",
        data: [
          {
            id: "command",
            object: "model",
            created: 0,
            owned_by: "cohere",
            _: { endpoints: ["chat"] },
          },
        ],
      });

      expect(
        new GoogleAiStudio().modelsToOpenAIFormat({
          models: [
            {
              name: "models/gemini",
              version: "1",
              displayName: "Gemini",
              description: "model",
              inputTokenLimit: 1,
              outputTokenLimit: 1,
              supportedGenerationMethods: ["generateContent"],
              temperature: 1,
              maxTemperature: 2,
              topP: 1,
              topK: 1,
            },
          ],
        }),
      ).toMatchObject({
        object: "list",
        data: [
          {
            id: "gemini",
            object: "model",
            created: 0,
            owned_by: "google_ai_studio",
            _: { version: "1" },
          },
        ],
      });

      const openAiShaped = {
        data: [
          {
            id: "model",
            object: "model",
            created: 12,
            owned_by: "owner",
            active: true,
          },
        ],
      };
      expect(new Groq().modelsToOpenAIFormat(openAiShaped)).toEqual({
        object: "list",
        data: [
          {
            id: "model",
            object: "model",
            created: 12,
            owned_by: "owner",
            _: { active: true },
          },
        ],
      });
      expect(new Mistral().modelsToOpenAIFormat(openAiShaped)).toEqual({
        object: "list",
        data: [
          {
            id: "model",
            object: "model",
            created: 12,
            owned_by: "owner",
            _: { active: true },
          },
        ],
      });
      expect(
        new OpenRouter().modelsToOpenAIFormat({
          data: [{ id: "router-model", created: 42, name: "Router" }],
        }),
      ).toEqual({
        object: "list",
        data: [
          {
            id: "router-model",
            object: "model",
            created: 42,
            owned_by: "openrouter",
            _: { name: "Router" },
          },
        ],
      });
    });

    it("uses Google authentication appropriate to each endpoint", async () => {
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response());
      const provider = new GoogleAiStudio();

      await expect(provider.headers(1)).resolves.toEqual({
        "Content-Type": "application/json",
        "x-goog-api-key": "key-1",
      });
      await provider.fetch(
        "/v1beta/openai/chat/completions",
        { headers: { "x-goog-api-key": "old", "X-Custom": "value" } },
        1,
      );
      expect(fetchMock).toHaveBeenLastCalledWith(
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        {
          headers: {
            Authorization: "Bearer key-1",
            "Content-Type": "application/json",
            "X-Custom": "value",
          },
        },
      );

      await provider.fetch("/v1beta/models", undefined, 0);
      expect(fetchMock).toHaveBeenLastCalledWith(
        "https://generativelanguage.googleapis.com/v1beta/models",
        {
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": "key-0",
          },
        },
      );
    });

    it("requires both Cloudflare credentials and builds account-scoped requests", async () => {
      const provider = new WorkersAi();
      expect(provider.available()).toBe(true);
      expect(provider.baseUrl()).toBe(
        "https://api.cloudflare.com/client/v4/accounts/account-id/ai",
      );
      await expect(provider.headers(1)).resolves.toEqual({
        "Content-Type": "application/json",
        Authorization: "Bearer key-1",
      });
      expect(
        provider.modelsToOpenAIFormat({
          success: true,
          errors: [],
          messages: [],
          result: [{ name: "@cf/model", task: { name: "text" } }],
        }),
      ).toEqual({
        object: "list",
        data: [
          {
            id: "@cf/model",
            object: "model",
            created: 0,
            owned_by: "workers_ai",
            _: { task: { name: "text" } },
          },
        ],
      });

      vi.mocked(Secrets.getAll).mockImplementation((name) =>
        name === "CLOUDFLARE_API_KEY" ? [] : ["account-id"],
      );
      expect(provider.available()).toBe(false);
      vi.mocked(Secrets.getAll).mockImplementation((name) =>
        name === "CLOUDFLARE_ACCOUNT_ID" ? [] : ["api-key"],
      );
      expect(provider.available()).toBe(false);
    });

    it.each([
      [new HuggingFace(), "HuggingFace"],
      [new Replicate(), "Replicate"],
    ])("rejects unsupported operations for %s", async (provider, name) => {
      await expect(
        provider.buildChatCompletionsRequest({ body: "{}", headers: {} }),
      ).rejects.toThrow(
        new ProviderNotSupportedError(
          `${name} does not support chat completions`,
        ),
      );
      await expect(provider.buildModelsRequest()).rejects.toThrow(
        new ProviderNotSupportedError(
          `${name} does not support models list via this proxy.`,
        ),
      );
    });

    it("rejects the unsupported Perplexity models operation", async () => {
      await expect(new PerplexityAi().buildModelsRequest()).rejects.toThrow(
        "Perplexity AI does not support models list via this proxy.",
      );
    });
  });

  describe("CustomOpenAI", () => {
    it("normalizes credentials, rotates multiple keys, and creates static models", async () => {
      const provider = new CustomOpenAI({
        name: "custom",
        baseUrl: "https://custom.example",
        apiKeys: ["first", "second"],
        models: ["one", "two"],
      });

      expect(provider.available()).toBe(true);
      expect(provider.baseUrl()).toBe("https://custom.example");
      expect(provider.getApiKeys()).toEqual(["first", "second"]);
      expect(await provider.getNextApiKeyIndex()).toBe(1);
      expect(Secrets.getNextIndex).toHaveBeenCalledWith("custom", 2);
      await expect(provider.headers(3)).resolves.toEqual({
        "Content-Type": "application/json",
        Authorization: "Bearer second",
      });
      await expect(provider.headers()).resolves.toEqual({
        "Content-Type": "application/json",
        Authorization: "Bearer first",
      });
      expect(provider.staticModels()).toMatchObject({
        object: "list",
        data: [
          { id: "one", object: "model", owned_by: "custom" },
          { id: "two", object: "model", owned_by: "custom" },
        ],
      });
    });

    it("handles absent, scalar, and single credentials without rotation", async () => {
      const withoutKeys = new CustomOpenAI({
        name: "none",
        baseUrl: "https://none.example",
      });
      expect(withoutKeys.getApiKeys()).toEqual([]);
      await expect(withoutKeys.headers()).resolves.toEqual({
        "Content-Type": "application/json",
      });
      expect(withoutKeys.staticModels()).toBeUndefined();

      const scalarKey = new CustomOpenAI({
        name: "scalar",
        baseUrl: "https://scalar.example",
        apiKeys: "only",
        models: [],
      });
      expect(scalarKey.getApiKeys()).toEqual(["only"]);
      expect(await scalarKey.getNextApiKeyIndex()).toBe(0);
      expect(scalarKey.staticModels()).toBeUndefined();
      expect(Secrets.getNextIndex).not.toHaveBeenCalled();
    });
  });
});
