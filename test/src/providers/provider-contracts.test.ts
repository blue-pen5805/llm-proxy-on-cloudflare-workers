import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Anthropic } from "~/src/providers/anthropic/provider";
import { Cerebras } from "~/src/providers/cerebras/provider";
import { chatParameterFilter } from "~/src/providers/chat_parameters";
import { Cline } from "~/src/providers/cline/provider";
import { Cohere } from "~/src/providers/cohere/provider";
import { CustomOpenAI } from "~/src/providers/custom-openai";
import { DeepSeek } from "~/src/providers/deepseek/provider";
import { GoogleAiStudio } from "~/src/providers/google-ai-studio/provider";
import { Grok } from "~/src/providers/grok/provider";
import { Groq } from "~/src/providers/groq/provider";
import { HuggingFace } from "~/src/providers/huggingface/provider";
import { chatCompletionsEndpoint } from "~/src/providers/inference";
import { Mistral } from "~/src/providers/mistral/provider";
import { buildModelsRequest } from "~/src/providers/models";
import { NvidiaNim } from "~/src/providers/nvidia-nim/provider";
import { Ollama } from "~/src/providers/ollama/provider";
import { OpenAI } from "~/src/providers/openai/provider";
import { OpenRouter } from "~/src/providers/openrouter/provider";
import { PerplexityAi } from "~/src/providers/perplexity-ai/provider";
import {
  createProvider,
  OpenAICompatibleProvider,
  ProviderBase,
  withProviderProfile,
} from "~/src/providers/provider";
import { Replicate } from "~/src/providers/replicate/provider";
import { WorkersAi } from "~/src/providers/workers_ai/provider";
import { Secrets } from "~/src/utils/secrets";
import { buildInferenceRequest } from "../../helpers/provider";

describe("provider contracts", () => {
  beforeEach(() => {
    vi.spyOn(Secrets, "get").mockImplementation((name, index) =>
      name === "CLOUDFLARE_ACCOUNT_ID" ? "account-id" : `key-${index ?? 0}`,
    );
    vi.spyOn(Secrets, "getAll").mockReturnValue(["key-0", "key-1"]);
    vi.spyOn(Secrets, "getProfiles").mockReturnValue(["default", "paid"]);
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
      expect(provider.getCredentialProfiles()).toEqual([]);
      expect(provider.getAiGatewayApiKeys()).toEqual([]);
      expect(provider.configurationError()).toBeUndefined();
      expect(await provider.getNextApiKeyIndex()).toBe(0);
      expect(provider.baseUrl()).toBe("https://example.com");
      expect(provider.pathnamePrefix()).toBe("");
      expect(await provider.headers()).toEqual({});
      expect(
        new Headers(await provider.buildHeadersForPath("/resource")),
      ).toEqual(new Headers());
      expect(
        provider.endpoints.models?.getStaticModels?.call(provider),
      ).toBeUndefined();
      expect(provider.aiGatewayPath("/models")).toBe("/models");
      expect(provider.endpoints).toEqual({});
      expect(
        await provider.resolveInference("model-id", "chat_completions"),
      ).toBeUndefined();
    });

    it("rotates configured credentials and merges request headers", async () => {
      const provider = createProvider({
        apiKeyName: "OPENAI_API_KEY",
        baseUrl: "https://api.example.test",
        pathnamePrefix: "/v1",
        async headers(index): Promise<HeadersInit> {
          return { Authorization: `Bearer key-${index ?? 0}` };
        },
      });

      expect(provider.available()).toBe(true);
      expect(provider.getApiKeys()).toEqual(["key-0", "key-1"]);
      expect(provider.getAiGatewayApiKeys()).toEqual(["key-0", "key-1"]);
      expect(Secrets.getAll).toHaveBeenCalledWith("OPENAI_API_KEY");
      expect(await provider.getNextApiKeyIndex()).toBe(1);
      expect(Secrets.getNext).toHaveBeenCalledWith("OPENAI_API_KEY");

      const [url, init] = await provider.buildRequest(
        "/models",
        { method: "GET", headers: { Accept: "application/json" } },
        1,
      );
      expect(url).toBe("https://api.example.test/v1/models");
      expect(init.method).toBe("GET");
      expect(new Headers(init.headers)).toEqual(
        new Headers({
          Accept: "application/json",
          Authorization: "Bearer key-1",
        }),
      );
    });

    it("uses named credential profiles for keys, Gateway keys, and rotation", async () => {
      const provider = withProviderProfile(
        createProvider({ apiKeyName: "OPENAI_API_KEY" }),
        "paid",
      );

      expect(provider.getApiKeys()).toEqual(["key-0", "key-1"]);
      expect(provider.getAiGatewayApiKeys()).toEqual(["key-0", "key-1"]);
      expect(provider.getCredentialProfiles()).toEqual(["default", "paid"]);
      await expect(provider.getNextApiKeyIndex()).resolves.toBe(1);
      expect(Secrets.getAll).toHaveBeenCalledWith(
        "OPENAI_API_KEY",
        false,
        "paid",
      );
      expect(Secrets.getNext).toHaveBeenCalledWith("OPENAI_API_KEY", "paid");
    });

    it("does not rotate a single configured credential", async () => {
      vi.mocked(Secrets.getAll).mockReturnValue(["only-key"]);

      const provider = createProvider({ apiKeyName: "OPENAI_API_KEY" });
      expect(await provider.getNextApiKeyIndex()).toBe(0);
      expect(Secrets.getNext).not.toHaveBeenCalled();
    });

    it("falls back safely when a key source has no binding name", async () => {
      const provider = createProvider({
        getApiKeys(): string[] {
          return ["first", "second"];
        },
      });

      expect(await provider.getNextApiKeyIndex()).toBe(0);
    });

    it("drops explicitly unsupported fields and retains extensions", async () => {
      const provider = createProvider({
        endpoints: {
          chat_completions: chatCompletionsEndpoint(),
          models: { path: "/models" },
        },
      });
      vi.spyOn(provider, "headers").mockResolvedValue({
        Authorization: "provider-header",
        "X-Provider": "kept",
      });

      const [chatPath, chatInit] = await buildInferenceRequest(provider, {
        data: {
          model: "model-id",
          messages: [],
          temperature: 0.5,
          verbosity: "high",
          unsupported: "retained",
        },
        headers: { Authorization: "caller-header" },
        apiKeyIndex: 1,
        target: "direct",
      });
      expect(chatPath).toBe("https://example.com/chat/completions");
      expect(chatInit).toMatchObject({
        method: "POST",
        body: JSON.stringify({
          model: "model-id",
          messages: [],
          temperature: 0.5,
          verbosity: "high",
          unsupported: "retained",
        }),
      });
      // Provider-computed headers take precedence over caller-supplied ones.
      expect(new Headers(chatInit.headers)).toEqual(
        new Headers({
          "content-type": "application/json",
          Authorization: "provider-header",
          "X-Provider": "kept",
        }),
      );

      const preparedData = {
        model: "prepared-model",
        messages: [],
        unsupported: "removed",
      };
      const [, preparedInit] = await buildInferenceRequest(provider, {
        data: { model: preparedData.model, messages: [] },
        headers: {},
        target: "direct",
      });
      expect(preparedInit.body).toBe(
        JSON.stringify({ model: "prepared-model", messages: [] }),
      );

      await expect(
        buildModelsRequest(provider, provider.endpoints.models!, 1),
      ).resolves.toEqual([
        "/models",
        {
          method: "GET",
          headers: new Headers({
            Authorization: "provider-header",
            "X-Provider": "kept",
          }),
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
        headers: expect.any(Headers),
        redirect: "manual",
      });
      expect(new Headers(fetchMock.mock.calls[0][1]?.headers)).toEqual(
        new Headers(),
      );
      expect(response.status).toBe(202);
      expect(await response.text()).toBe("proxied");
    });
  });

  describe("OpenAI-compatible credentials", () => {
    it("preserves the existing base and OpenAI-compatible instance contracts", () => {
      const provider = new OpenAI();

      expect(provider).toBeInstanceOf(ProviderBase);
      expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
      expect(provider).toBeInstanceOf(OpenAI);
    });

    it("omits authorization when no API key exists", async () => {
      vi.mocked(Secrets.getAll).mockReturnValue([]);
      expect(await new OpenAICompatibleProvider().headers()).toEqual({});
    });

    it("selects and wraps credential indexes", async () => {
      const provider = new OpenAICompatibleProvider();
      vi.spyOn(provider, "getApiKeys").mockReturnValue(["first", "second"]);

      await expect(provider.headers()).resolves.toEqual({
        Authorization: "Bearer first",
      });
      await expect(provider.headers(3)).resolves.toEqual({
        Authorization: "Bearer second",
      });
    });
  });

  describe("built-in provider declarations", () => {
    // Every built-in provider is described by the same five values, so they are
    // asserted from one table instead of a near-identical file per provider.
    const declarations: [
      name: string,
      provider: ProviderBase,
      declaration: {
        apiKeyName: string;
        baseUrl: string;
        pathnamePrefix?: string;
        chatCompletionPath?: string;
        modelsPath?: string;
      },
    ][] = [
      [
        "anthropic",
        new Anthropic(),
        {
          apiKeyName: "ANTHROPIC_API_KEY",
          baseUrl: "https://api.anthropic.com",
          chatCompletionPath: "/v1/chat/completions",
          modelsPath: "/v1/models",
        },
      ],
      [
        "cerebras",
        new Cerebras(),
        {
          apiKeyName: "CEREBRAS_API_KEY",
          baseUrl: "https://api.cerebras.ai/v1",
        },
      ],
      [
        "cline",
        new Cline(),
        {
          apiKeyName: "CLINE_API_KEY",
          baseUrl: "https://api.cline.bot/api/v1",
          modelsPath: "/ai/cline/recommended-models",
        },
      ],
      [
        "cohere",
        new Cohere(),
        {
          apiKeyName: "COHERE_API_KEY",
          baseUrl: "https://api.cohere.com",
          chatCompletionPath: "/compatibility/v1/chat/completions",
          modelsPath: "/v1/models?page_size=100&endpoint=chat",
        },
      ],
      [
        "deepseek",
        new DeepSeek(),
        {
          apiKeyName: "DEEPSEEK_API_KEY",
          baseUrl: "https://api.deepseek.com",
        },
      ],
      [
        "google-ai-studio",
        new GoogleAiStudio(),
        {
          apiKeyName: "GEMINI_API_KEY",
          baseUrl: "https://generativelanguage.googleapis.com",
          chatCompletionPath: "/v1beta/openai/chat/completions",
          modelsPath: "/v1beta/models",
        },
      ],
      [
        "grok",
        new Grok(),
        {
          apiKeyName: "GROK_API_KEY",
          baseUrl: "https://api.x.ai",
          chatCompletionPath: "/v1/chat/completions",
          modelsPath: "/v1/models",
        },
      ],
      [
        "groq",
        new Groq(),
        {
          apiKeyName: "GROQ_API_KEY",
          baseUrl: "https://api.groq.com/openai/v1",
        },
      ],
      [
        "huggingface",
        new HuggingFace(),
        {
          apiKeyName: "HUGGINGFACE_API_KEY",
          baseUrl: "https://api-inference.huggingface.co/models",
          chatCompletionPath: "",
          modelsPath: "",
        },
      ],
      [
        "mistral",
        new Mistral(),
        {
          apiKeyName: "MISTRAL_API_KEY",
          baseUrl: "https://api.mistral.ai",
          chatCompletionPath: "/v1/chat/completions",
          modelsPath: "/v1/models",
        },
      ],
      [
        "nvidia-nim",
        new NvidiaNim(),
        {
          apiKeyName: "NVIDIA_NIM_API_KEY",
          baseUrl: "https://integrate.api.nvidia.com",
          pathnamePrefix: "/v1",
        },
      ],
      [
        "ollama",
        new Ollama(),
        {
          apiKeyName: "OLLAMA_API_KEY",
          baseUrl: "https://ollama.com",
          pathnamePrefix: "/v1",
        },
      ],
      [
        "openai",
        new OpenAI(),
        {
          apiKeyName: "OPENAI_API_KEY",
          baseUrl: "https://api.openai.com/v1",
        },
      ],
      [
        "openrouter",
        new OpenRouter(),
        {
          apiKeyName: "OPENROUTER_API_KEY",
          baseUrl: "https://openrouter.ai/api",
          chatCompletionPath: "/v1/chat/completions",
          modelsPath: "/v1/models",
        },
      ],
      [
        "perplexity-ai",
        new PerplexityAi(),
        {
          apiKeyName: "PERPLEXITYAI_API_KEY",
          baseUrl: "https://api.perplexity.ai",
          chatCompletionPath: "/v1/chat/completions",
          modelsPath: "/v1/models",
        },
      ],
      [
        "replicate",
        new Replicate(),
        {
          apiKeyName: "REPLICATE_API_KEY",
          baseUrl: "https://api.replicate.com/v1",
          chatCompletionPath: "",
          modelsPath: "",
        },
      ],
      [
        "workers_ai",
        new WorkersAi(),
        {
          apiKeyName: "CLOUDFLARE_API_KEY",
          baseUrl:
            "https://api.cloudflare.com/client/v4/accounts/account-id/ai",
          chatCompletionPath: "/v1/chat/completions",
          modelsPath: "/models/search?task=Text%20Generation",
        },
      ],
    ];

    it.each(declarations)(
      "declares the credential and endpoints of %s",
      (_name, provider, declaration) => {
        expect(provider.apiKeyName).toBe(declaration.apiKeyName);
        expect(provider.baseUrl()).toBe(declaration.baseUrl);
        expect(provider.pathnamePrefix()).toBe(
          declaration.pathnamePrefix ?? "",
        );
        expect(provider.endpoints.chat_completions?.path).toBe(
          ["huggingface", "replicate"].includes(_name)
            ? undefined
            : (declaration.chatCompletionPath ?? "/chat/completions"),
        );
        expect(provider.endpoints.models?.path).toBe(
          ["huggingface", "replicate", "perplexity-ai"].includes(_name)
            ? undefined
            : (declaration.modelsPath ?? "/models"),
        );
      },
    );

    it.each(declarations)(
      "reports the credential availability of %s",
      (_name, provider) => {
        expect(provider.available()).toBe(true);
        vi.mocked(Secrets.getAll).mockReturnValue([]);
        expect(provider.available()).toBe(false);
      },
    );
  });

  describe("provider-specific behavior", () => {
    it("tracks the current OpenAI Chat Completions top-level parameters", () => {
      expect(
        chatParameterFilter()({
          model: "gpt-test",
          messages: [],
          moderation: { type: "omni-moderation-latest" },
          prompt_cache_key: "tenant",
          prompt_cache_options: { mode: "explicit", ttl: "30m" },
          prompt_cache_retention: "24h",
          safety_identifier: "hashed-user",
          web_search_options: {},
          suffix: "legacy",
        }),
      ).toEqual({
        model: "gpt-test",
        messages: [],
        moderation: { type: "omni-moderation-latest" },
        prompt_cache_key: "tenant",
        prompt_cache_options: { mode: "explicit", ttl: "30m" },
        prompt_cache_retention: "24h",
        safety_identifier: "hashed-user",
        web_search_options: {},
      });
    });

    it("builds Anthropic headers and converts model timestamps", async () => {
      const provider = new Anthropic();
      await expect(provider.headers(1)).resolves.toEqual({
        "x-api-key": "key-1",
        "anthropic-version": "2023-06-01",
      });
      expect(
        provider.endpoints.models!.convertResponse!.call(provider, {
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
        new Cohere().endpoints.models!.convertResponse!.call(new Cohere(), {
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
        new GoogleAiStudio().endpoints.models!.convertResponse!.call(
          new GoogleAiStudio(),
          {
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
          },
        ),
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
      expect(
        new Groq().endpoints.models!.convertResponse!.call(
          new Groq(),
          openAiShaped,
        ),
      ).toEqual({
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
        new Mistral().endpoints.models!.convertResponse!.call(
          new Mistral(),
          openAiShaped,
        ),
      ).toEqual({
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
        new OpenRouter().endpoints.models!.convertResponse!.call(
          new OpenRouter(),
          {
            data: [{ id: "router-model", created: 42, name: "Router" }],
          },
        ),
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

      await expect(provider.headers()).resolves.toEqual({
        "x-goog-api-key": "key-0",
      });
      await expect(provider.headers(1)).resolves.toEqual({
        "x-goog-api-key": "key-1",
      });
      expect(
        new Headers(
          await provider.buildHeadersForPath(
            "/v1beta/openai/chat/completions",
            undefined,
            1,
          ),
        ),
      ).toEqual(
        new Headers({
          authorization: "Bearer key-1",
        }),
      );
      expect(
        new Headers(
          await provider.buildHeadersForPath("/v1beta/models", undefined, 1),
        ),
      ).toEqual(
        new Headers({
          "x-goog-api-key": "key-1",
        }),
      );
      vi.mocked(Secrets.getAll).mockReturnValue([]);
      await expect(provider.headers()).resolves.toEqual({});
      expect(
        new Headers(
          await provider.buildHeadersForPath(
            "/v1beta/openai/chat/completions",
            undefined,
            0,
          ),
        ),
      ).toEqual(new Headers({}));
      vi.mocked(Secrets.getAll).mockReturnValue(["key-0", "key-1"]);
      const [builtChatPath, builtChatInit] = await buildInferenceRequest(
        provider,
        {
          data: { model: "gemini", messages: [] },
          headers: {
            Authorization: "Bearer caller-key",
            "x-goog-api-key": "caller-key",
            "X-Custom": "value",
          },
          apiKeyIndex: 1,
          target: "direct",
        },
      );
      expect(builtChatPath).toBe(
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      );
      expect(new Headers(builtChatInit.headers)).toEqual(
        new Headers({
          Authorization: "Bearer key-1",
          "Content-Type": "application/json",
          "X-Custom": "value",
        }),
      );

      await provider.fetch(
        "/v1beta/openai/chat/completions",
        { headers: { "x-goog-api-key": "old", "X-Custom": "value" } },
        1,
      );
      const [chatUrl, chatInit] = fetchMock.mock.calls.at(-1) ?? [];
      expect(chatUrl).toBe(
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      );
      expect(new Headers(chatInit?.headers)).toEqual(
        new Headers({
          Authorization: "Bearer key-1",
          "X-Custom": "value",
        }),
      );

      await provider.fetch("/v1beta/models", undefined, 0);
      const [modelsUrl, modelsInit] = fetchMock.mock.calls.at(-1) ?? [];
      expect(modelsUrl).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models",
      );
      expect(new Headers(modelsInit?.headers)).toEqual(
        new Headers({
          "x-goog-api-key": "key-0",
        }),
      );
    });

    it("requires both Cloudflare credentials and builds account-scoped requests", async () => {
      const provider = new WorkersAi();
      expect(provider.available()).toBe(true);
      expect(provider.baseUrl()).toBe(
        "https://api.cloudflare.com/client/v4/accounts/account-id/ai",
      );
      await expect(provider.headers(1)).resolves.toEqual({
        Authorization: "Bearer key-1",
      });
      const [modelsUrl] = await provider.buildRequest(
        provider.endpoints.models!.path,
        {
          method: "GET",
        },
      );
      expect(modelsUrl).toBe(
        "https://api.cloudflare.com/client/v4/accounts/account-id/ai/models/search?task=Text%20Generation",
      );
      expect(
        provider.endpoints.models!.convertResponse!.call(provider, {
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

    it("rejects an unsafe Cloudflare account identifier", () => {
      expect(new WorkersAi().configurationError()).toBeUndefined();
      vi.mocked(Secrets.get).mockReturnValue("");
      expect(new WorkersAi().configurationError()).toBeUndefined();

      vi.mocked(Secrets.get).mockImplementation((name) =>
        name === "CLOUDFLARE_ACCOUNT_ID" ? "../other-account" : "key-0",
      );
      const provider = new WorkersAi();
      expect(provider.configurationError()).toContain("invalid");
      expect(() => provider.baseUrl()).toThrow("missing or invalid");
    });

    it.each([new Replicate()])(
      "does not declare unsupported inference or models for %s",
      async (provider) => {
        expect(
          await provider.resolveInference("model", "chat_completions"),
        ).toBeUndefined();
        expect(provider.endpoints.models).toBeUndefined();
      },
    );

    it("does not declare a Perplexity models operation", () => {
      expect(new PerplexityAi().endpoints.models).toBeUndefined();
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
        Authorization: "Bearer second",
      });
      await expect(provider.headers()).resolves.toEqual({
        Authorization: "Bearer first",
      });
      expect(
        provider.endpoints.models?.getStaticModels?.call(provider),
      ).toMatchObject({
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
      await expect(withoutKeys.headers()).resolves.toEqual({});
      expect(
        withoutKeys.endpoints.models?.getStaticModels?.call(withoutKeys),
      ).toBeUndefined();

      const scalarKey = new CustomOpenAI({
        name: "scalar",
        baseUrl: "https://scalar.example",
        apiKeys: "only",
        models: [],
      });
      expect(scalarKey.getApiKeys()).toEqual(["only"]);
      expect(await scalarKey.getNextApiKeyIndex()).toBe(0);
      expect(
        scalarKey.endpoints.models?.getStaticModels?.call(scalarKey),
      ).toBeUndefined();
      expect(Secrets.getNextIndex).not.toHaveBeenCalled();

      expect(withProviderProfile(scalarKey, "paid").getApiKeys()).toEqual([]);
    });

    it("selects and rotates named custom endpoint profiles", async () => {
      const baseProvider = new CustomOpenAI({
        name: "custom-profiled",
        baseUrl: "https://custom.example",
        apiKeys: {
          default: "default-key",
          paid: ["paid-one", "paid-two"],
          "bad/profile": "ignored",
        },
      });
      const paidProvider = withProviderProfile(baseProvider, "paid");

      expect(baseProvider.getCredentialProfiles()).toEqual(["default", "paid"]);
      expect(paidProvider.getApiKeys()).toEqual(["paid-one", "paid-two"]);
      await expect(paidProvider.getNextApiKeyIndex()).resolves.toBe(1);
      expect(Secrets.getNextIndex).toHaveBeenCalledWith(
        "custom-profiled:paid",
        2,
      );
    });
  });
});
