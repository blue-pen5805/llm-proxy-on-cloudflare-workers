import {
  AI_GATEWAY_COMPATIBILITY_PROVIDERS,
  BUILT_IN_LIVE_CHAT_CONTRACTS,
  MAX_ERROR_DETAIL_BYTES,
  MIN_COMPLETION_TOKENS,
  parseLiveChatConfig,
  parseLocalWorkerAuthentication,
  runLiveChatTests,
  verifyLocalDevelopmentServer,
} from "../../scripts/test-live-chat";
import { CloudflareAIGateway } from "../../src/ai_gateway";
import { BUILT_IN_PROVIDER_CONSTRUCTORS } from "../../src/providers";
import { describe, expect, it, vi } from "vitest";

describe("live Chat Completions test script", () => {
  it("reads proxy authentication from the local Worker configuration", () => {
    expect(
      parseLocalWorkerAuthentication(
        '{"DEV":false,"PROXY_API_KEY":["first","second"]}',
      ),
    ).toEqual({
      developmentMode: false,
      proxyApiKey: "first",
      sensitiveValues: ["second", "first"],
    });
    expect(parseLocalWorkerAuthentication('{"DEV":true}')).toEqual({
      developmentMode: true,
      proxyApiKey: undefined,
      sensitiveValues: [],
    });
    expect(() => parseLocalWorkerAuthentication('{"DEV":false}')).toThrow(
      "must set PROXY_API_KEY unless DEV is true",
    );
  });

  it("provides valid Direct paths for every provider in the example", () => {
    const exampleProviders = [
      "anthropic",
      "aws-bedrock",
      "azure-openai",
      "cerebras",
      "cohere",
      "deepseek",
      "google-ai-studio",
      "google-vertex-ai",
      "grok",
      "groq",
      "mistral",
      "ollama",
      "openai",
      "openrouter",
      "perplexity-ai",
      "workers-ai",
    ];
    const configuredExample = JSON.stringify({
      providers: Object.fromEntries(
        exampleProviders.map((provider) => [provider, "model-id"]),
      ),
    });

    expect(Object.keys(BUILT_IN_LIVE_CHAT_CONTRACTS)).toEqual(exampleProviders);
    expect(parseLiveChatConfig(configuredExample)).toHaveLength(16);

    for (const providerName of exampleProviders) {
      const ProviderConstructor = BUILT_IN_PROVIDER_CONSTRUCTORS[providerName];
      const provider = new ProviderConstructor();
      const contract =
        BUILT_IN_LIVE_CHAT_CONTRACTS[
          providerName as keyof typeof BUILT_IN_LIVE_CHAT_CONTRACTS
        ];
      expect(contract.directPath).toBe(provider.chatCompletionPath);
      expect(contract.supportsMaxCompletionTokens).toBe(
        provider.CHAT_COMPLETIONS_SUPPORTED_PARAMETERS.includes(
          "max_completion_tokens",
        ),
      );
      expect(AI_GATEWAY_COMPATIBILITY_PROVIDERS.has(providerName)).toBe(
        CloudflareAIGateway.isSupportedProvider(providerName, true),
      );
    }
  });

  it("loads selected built-in models and skips null entries", () => {
    expect(
      parseLiveChatConfig(`{
        // Only selected providers make requests.
        "providers": {
          "openai": "gpt-test",
          "anthropic": null,
        },
      }`),
    ).toEqual([
      expect.objectContaining({
        provider: "openai",
        model: "gpt-test",
        directPath: "/chat/completions",
      }),
    ]);
  });

  it("requires a direct path for unsupported or custom providers", () => {
    expect(() =>
      parseLiveChatConfig('{"providers":{"huggingface":"model"}}'),
    ).toThrow("has no Chat Completions direct path");
    expect(() =>
      parseLiveChatConfig('{"providers":{"custom":"model"}}'),
    ).toThrow("has no Chat Completions direct path");

    expect(
      parseLiveChatConfig(
        '{"providers":{"custom":{"model":"model","directPath":"/v1/chat/completions"}}}',
      ),
    ).toEqual([
      {
        provider: "custom",
        model: "model",
        directPath: "/v1/chat/completions",
        supportsMaxCompletionTokens: true,
      },
    ]);
  });

  it("rejects unsafe direct paths", () => {
    expect(() =>
      parseLiveChatConfig(
        '{"providers":{"custom":{"model":"model","directPath":"//attacker.example/chat"}}}',
      ),
    ).toThrow("must be a safe absolute path");
  });

  it("calls direct, compatibility, and AI Gateway routes", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 200,
      }),
    );
    const testCases = parseLiveChatConfig(
      '{"providers":{"openai":"gpt-test"}}',
    );

    await expect(
      runLiveChatTests(testCases, {
        baseUrl: "http://127.0.0.1:8787/",
        proxyApiKey: "proxy-secret",
        gatewayName: "live gateway",
        fetcher,
      }),
    ).resolves.toEqual([
      { provider: "openai", route: "direct", status: 200 },
      { provider: "openai", route: "compatibility", status: 200 },
      { provider: "openai", route: "ai-gateway", status: 200 },
    ]);

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[0][0]).toBe(
      "http://127.0.0.1:8787/key/0/g/live%20gateway/openai/chat/completions",
    );
    expect(fetcher.mock.calls[1][0]).toBe(
      "http://127.0.0.1:8787/key/0/g/live%20gateway/v1/chat/completions",
    );
    expect(fetcher.mock.calls[2][0]).toBe(
      "http://127.0.0.1:8787/key/0/g/live%20gateway/chat/completions",
    );
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      model: "gpt-test",
      messages: [{ role: "user", content: "Reply with OK." }],
      stream: false,
      max_completion_tokens: MIN_COMPLETION_TOKENS,
    });
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({
      model: "openai/gpt-test",
      messages: [{ role: "user", content: "Reply with OK." }],
      stream: false,
      max_completion_tokens: MIN_COMPLETION_TOKENS,
    });
    expect(JSON.parse(String(fetcher.mock.calls[2][1]?.body))).toEqual({
      model: "openai/gpt-test",
      messages: [{ role: "user", content: "Reply with OK." }],
      stream: false,
      max_completion_tokens: MIN_COMPLETION_TOKENS,
    });
  });

  it("uses the default Gateway and skips unsupported providers", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    const testCases = parseLiveChatConfig(
      '{"providers":{"openai":"gpt-test","ollama":"model-test"}}',
    );

    const results = await runLiveChatTests(testCases, {
      baseUrl: "http://127.0.0.1:8787",
      proxyApiKey: "proxy-secret",
      fetcher,
    });

    expect(results.map(({ provider, route }) => ({ provider, route }))).toEqual(
      [
        { provider: "openai", route: "direct" },
        { provider: "openai", route: "compatibility" },
        { provider: "openai", route: "ai-gateway" },
        { provider: "ollama", route: "direct" },
        { provider: "ollama", route: "compatibility" },
      ],
    );
    expect(fetcher.mock.calls[2][0]).toBe(
      "http://127.0.0.1:8787/key/0/g/default/chat/completions",
    );
  });

  it("rejects deployed Worker targets", async () => {
    await expect(
      runLiveChatTests(
        [
          {
            provider: "openai",
            model: "gpt-test",
            directPath: "/chat/completions",
            supportsMaxCompletionTokens: true,
          },
        ],
        {
          baseUrl: "https://deployed-worker.example",
          proxyApiKey: "proxy-secret",
          fetcher: vi.fn<typeof fetch>(),
        },
      ),
    ).rejects.toThrow("must target a loopback development server");
  });

  it("checks that the local development server is ready", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("Pong", { status: 200 }));

    await expect(
      verifyLocalDevelopmentServer(
        "http://127.0.0.1:8787",
        "proxy-secret",
        fetcher,
      ),
    ).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/ping",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer proxy-secret",
        }),
      }),
    );
  });

  it("does not probe a deployed target during the readiness check", async () => {
    const fetcher = vi.fn<typeof fetch>();

    await expect(
      verifyLocalDevelopmentServer(
        "https://deployed-worker.example",
        "proxy-secret",
        fetcher,
      ),
    ).rejects.toThrow("must target a loopback development server");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses the provider-supported legacy token field only when required", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    const testCases = parseLiveChatConfig(
      '{"providers":{"cohere":"command-test"}}',
    );

    await runLiveChatTests(testCases, {
      baseUrl: "http://127.0.0.1:8787",
      proxyApiKey: "proxy-secret",
      fetcher,
    });

    for (const call of fetcher.mock.calls) {
      expect(JSON.parse(String(call[1]?.body))).toMatchObject({
        max_tokens: MIN_COMPLETION_TOKENS,
      });
      expect(JSON.parse(String(call[1]?.body))).not.toHaveProperty(
        "max_completion_tokens",
      );
    }
  });

  it("can omit explicit key selection for Gateway-managed BYOK", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    const testCases = parseLiveChatConfig(
      '{"providers":{"openai":"gpt-test"}}',
    );

    await runLiveChatTests(testCases, {
      baseUrl: "http://127.0.0.1:8787",
      proxyApiKey: "proxy-secret",
      keySelection: null,
      fetcher,
    });

    expect(fetcher.mock.calls[0][0]).toBe(
      "http://127.0.0.1:8787/openai/chat/completions",
    );
    expect(fetcher.mock.calls[1][0]).toBe(
      "http://127.0.0.1:8787/v1/chat/completions",
    );
    expect(fetcher.mock.calls[2][0]).toBe(
      "http://127.0.0.1:8787/g/default/chat/completions",
    );
  });

  it("reports structured HTTP error details with credentials redacted", async () => {
    const responseBody = JSON.stringify({
      error: {
        message: "model not found",
        type: "invalid_request_error",
        code: "model_not_found",
        api_key: "sk-secret123456",
        authorization: "Bearer provider-secret",
      },
      proxy: "proxy-secret",
      detail: "provider-live-secret is invalid",
    });
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(responseBody, {
          status: 401,
          statusText: "Unauthorized",
        }),
    );
    const testCases = parseLiveChatConfig(
      '{"providers":{"openai":"gpt-test"}}',
    );

    const results = await runLiveChatTests(testCases, {
      baseUrl: "http://127.0.0.1:8787",
      proxyApiKey: "proxy-secret",
      sensitiveValues: ["provider-live-secret"],
      fetcher,
    });

    expect(results).toEqual([
      {
        provider: "openai",
        route: "direct",
        status: 401,
        error:
          'HTTP 401 Unauthorized: {"error":{"message":"model not found","type":"invalid_request_error","code":"model_not_found","api_key":"***","authorization":"***"},"proxy":"***","detail":"*** is invalid"}',
      },
      {
        provider: "openai",
        route: "compatibility",
        status: 401,
        error:
          'HTTP 401 Unauthorized: {"error":{"message":"model not found","type":"invalid_request_error","code":"model_not_found","api_key":"***","authorization":"***"},"proxy":"***","detail":"*** is invalid"}',
      },
      {
        provider: "openai",
        route: "ai-gateway",
        status: 401,
        error:
          'HTTP 401 Unauthorized: {"error":{"message":"model not found","type":"invalid_request_error","code":"model_not_found","api_key":"***","authorization":"***"},"proxy":"***","detail":"*** is invalid"}',
      },
    ]);
    expect(JSON.stringify(results)).toContain("model not found");
    expect(JSON.stringify(results)).not.toContain("sk-secret123456");
    expect(JSON.stringify(results)).not.toContain("provider-secret");
    expect(JSON.stringify(results)).not.toContain("provider-live-secret");
    expect(JSON.stringify(results)).not.toContain("proxy-secret");
  });

  it("reports redacted plain-text error details", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () =>
          new Response(
            "upstream says Bearer top-secret and rejected sk-abcdefghijk",
            { status: 429, statusText: "Too Many Requests" },
          ),
      );
    const testCases = parseLiveChatConfig(
      '{"providers":{"openai":"gpt-test"}}',
    );

    const results = await runLiveChatTests(testCases, {
      baseUrl: "http://127.0.0.1:8787",
      proxyApiKey: "proxy-secret",
      fetcher,
    });

    expect(results[0].error).toBe(
      "HTTP 429 Too Many Requests: upstream says Bearer *** and rejected sk-***",
    );
    expect(JSON.stringify(results)).not.toContain("top-secret");
    expect(JSON.stringify(results)).not.toContain("abcdefghijk");
  });

  it("bounds oversized HTTP error details", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response("x".repeat(MAX_ERROR_DETAIL_BYTES + 100), {
          status: 500,
        }),
    );
    const testCases = parseLiveChatConfig(
      '{"providers":{"openai":"gpt-test"}}',
    );

    const results = await runLiveChatTests(testCases, {
      baseUrl: "http://127.0.0.1:8787",
      proxyApiKey: "proxy-secret",
      fetcher,
    });

    expect(results[0].error).toContain(
      `[truncated at ${MAX_ERROR_DETAIL_BYTES} bytes]`,
    );
    expect(results[0].error?.length).toBeLessThan(MAX_ERROR_DETAIL_BYTES + 100);
  });
});
