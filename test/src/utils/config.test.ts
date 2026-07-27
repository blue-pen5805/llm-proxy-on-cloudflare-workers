import { describe, it, expect, vi, beforeEach } from "vitest";
import { Config } from "~/src/utils/config";
import { Environments } from "~/src/utils/environments";
import { ConfigurationError } from "~/src/utils/error";

vi.mock("~/src/utils/environments");

describe("Config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isDevelopment", () => {
    it("should return true when DEV is true", () => {
      vi.mocked(Environments.get).mockReturnValue("true");

      const result = Config.isDevelopment();

      expect(result).toBe(true);
      expect(Environments.get).toHaveBeenCalledWith("DEV", false);
    });

    it("should return true when DEV is 'true'", () => {
      vi.mocked(Environments.get).mockReturnValue("true");

      const result = Config.isDevelopment();

      expect(result).toBe(true);
    });

    it("should return false when DEV is 'false'", () => {
      vi.mocked(Environments.get).mockReturnValue("false");

      const result = Config.isDevelopment();

      expect(result).toBe(false);
    });

    it("should return false when DEV is 'False'", () => {
      vi.mocked(Environments.get).mockReturnValue("False");

      const result = Config.isDevelopment();

      expect(result).toBe(false);
    });

    it("should return false when DEV is undefined", () => {
      vi.mocked(Environments.get).mockReturnValue(undefined);

      const result = Config.isDevelopment();

      expect(result).toBe(false);
    });

    it("should return false when DEV is any other string", () => {
      vi.mocked(Environments.get).mockReturnValue("development");

      const result = Config.isDevelopment();

      expect(result).toBe(false);
    });
  });

  describe("apiKeys", () => {
    it("reads the raw secret and treats a bare string as one key", () => {
      vi.mocked(Environments.get).mockReturnValue("test-key");

      const result = Config.apiKeys();

      expect(result).toEqual(["test-key"]);
      expect(Environments.get).toHaveBeenCalledWith("PROXY_API_KEY", false);
    });

    it("returns an empty array when PROXY_API_KEY is blank", () => {
      vi.mocked(Environments.get).mockReturnValue("   ");
      expect(Config.apiKeys()).toEqual([]);
    });

    it("does not split a single key on commas", () => {
      vi.mocked(Environments.get).mockReturnValue("aB3,x9Kf2,qWer");
      expect(Config.apiKeys()).toEqual(["aB3,x9Kf2,qWer"]);
    });

    it("does not coerce a purely numeric key", () => {
      vi.mocked(Environments.get).mockReturnValue("12345678");
      expect(Config.apiKeys()).toEqual(["12345678"]);
    });

    it("parses multiple keys only from a JSON array", () => {
      vi.mocked(Environments.get).mockReturnValue('["key1","key2"]');
      expect(Config.apiKeys()).toEqual(["key1", "key2"]);
    });

    it("trims entries and drops blanks inside a JSON array", () => {
      vi.mocked(Environments.get).mockReturnValue('[" key1 ",""," key2"]');
      expect(Config.apiKeys()).toEqual(["key1", "key2"]);
    });

    it("treats an invalid JSON-array-like value as a single key", () => {
      vi.mocked(Environments.get).mockReturnValue("[not-json");
      expect(Config.apiKeys()).toEqual(["[not-json"]);
    });

    it("should return undefined when PROXY_API_KEY is undefined", () => {
      vi.mocked(Environments.get).mockReturnValue(undefined);
      expect(Config.apiKeys()).toBeUndefined();
    });

    it("rejects a JSON array containing non-string keys", () => {
      vi.mocked(Environments.get).mockReturnValue('["valid",42]');
      expect(Config.apiKeys()).toBeUndefined();
    });

    it("rejects an excessive number of proxy authentication keys", () => {
      vi.mocked(Environments.get).mockReturnValue(
        JSON.stringify(
          Array.from({ length: 65 }, (_, index) => `key-${index}`),
        ),
      );
      expect(Config.apiKeys()).toBeUndefined();
    });

    it("memoizes parsed keys while the raw value is unchanged", () => {
      vi.mocked(Environments.get).mockReturnValue('["memo1","memo2"]');
      const first = Config.apiKeys();
      expect(first).toEqual(["memo1", "memo2"]);
      expect(Config.apiKeys()).toEqual(first);
    });

    it("memoizes by the request environment identity", () => {
      const environment = {} as Env;
      vi.mocked(Environments.get).mockReturnValue('["cached"]');
      vi.mocked(Environments.getEnv).mockReturnValue(environment);
      const first = Config.apiKeys();
      expect(Config.apiKeys()).toBe(first);
    });
  });

  describe("aiGateway", () => {
    it("should return AI Gateway configuration", () => {
      vi.mocked(Environments.get)
        .mockReturnValueOnce("test-account-id")
        .mockReturnValueOnce("test-gateway-name")
        .mockReturnValueOnce("test-token")
        .mockReturnValueOnce("rest-token")
        .mockReturnValueOnce("true");

      const result = Config.aiGateway();

      expect(result).toEqual({
        accountId: "test-account-id",
        name: "test-gateway-name",
        token: "test-token",
        restApiToken: "rest-token",
        alwaysUse: true,
      });
      expect(Environments.get).toHaveBeenCalledWith(
        "CLOUDFLARE_ACCOUNT_ID",
        false,
      );
      expect(Environments.get).toHaveBeenCalledWith("AI_GATEWAY_NAME", false);
      expect(Environments.get).toHaveBeenCalledWith("CF_AIG_TOKEN", false);
      expect(Environments.get).toHaveBeenCalledWith(
        "CLOUDFLARE_API_TOKEN",
        false,
      );
      expect(Environments.get).toHaveBeenCalledWith(
        "ALWAYS_USE_AI_GATEWAY",
        false,
      );
    });

    it("should return configuration with undefined values when not set", () => {
      vi.mocked(Environments.get).mockReturnValue(undefined);

      const result = Config.aiGateway();

      expect(result).toEqual({
        accountId: undefined,
        name: undefined,
        token: undefined,
        restApiToken: undefined,
        alwaysUse: false,
      });
    });

    it("should handle mixed defined and undefined values", () => {
      vi.mocked(Environments.get)
        .mockReturnValueOnce("test-account-id")
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce("test-token")
        .mockReturnValueOnce("rest-token")
        .mockReturnValueOnce(undefined);

      const result = Config.aiGateway();

      expect(result).toEqual({
        accountId: "test-account-id",
        name: undefined,
        token: "test-token",
        restApiToken: "rest-token",
        alwaysUse: false,
      });
    });
  });

  describe("defaultModel", () => {
    it("should return default model when set", () => {
      vi.mocked(Environments.get).mockReturnValue("openai/gpt-4");

      const result = Config.defaultModel();

      expect(result).toBe("openai/gpt-4");
      expect(Environments.get).toHaveBeenCalledWith("DEFAULT_MODEL", false);
    });

    it("should return undefined when not set", () => {
      vi.mocked(Environments.get).mockReturnValue(undefined);

      const result = Config.defaultModel();

      expect(result).toBeUndefined();
    });

    it("should handle empty string", () => {
      vi.mocked(Environments.get).mockReturnValue("");

      const result = Config.defaultModel();

      expect(result).toBe("");
    });
  });

  describe("chatResponseMetadataEnabled", () => {
    it.each([
      ["true", true],
      [" TRUE ", true],
      ["false", false],
      ["1", false],
      ["", false],
      [undefined, false],
    ])("maps %j to %s", (value, expected) => {
      vi.mocked(Environments.get).mockReturnValue(value);

      expect(Config.chatResponseMetadataEnabled()).toBe(expected);
      expect(Environments.get).toHaveBeenCalledWith(
        "CHAT_RESPONSE_METADATA_ENABLED",
        false,
      );
    });
  });

  describe("modelsCacheTtlSeconds", () => {
    it.each([
      [undefined, 300],
      ["", 300],
      ["   ", 300],
      ["0", 0],
      [" 120 ", 120],
      ["-1", 300],
      ["1.5", 300],
      ["abc", 300],
      ["100000", 86400],
    ])("maps %j to %d", (value, expected) => {
      vi.mocked(Environments.get).mockReturnValue(value);
      expect(Config.modelsCacheTtlSeconds()).toBe(expected);
      expect(Environments.get).toHaveBeenCalledWith(
        "MODELS_CACHE_TTL_SECONDS",
        false,
      );
    });
  });

  describe("allowedOrigins", () => {
    it.each([undefined, null])("maps %j to wildcard behavior", (value) => {
      vi.mocked(Environments.get).mockReturnValue(value as never);
      expect(Config.allowedOrigins()).toBeUndefined();
    });

    it("accepts exact HTTP and HTTPS origins", () => {
      vi.mocked(Environments.get).mockReturnValue([
        "https://app.example",
        "http://localhost:3000",
      ]);
      expect(Config.allowedOrigins()).toEqual([
        "https://app.example",
        "http://localhost:3000",
      ]);
    });

    it.each([
      ["not an array", "https://app.example"],
      ["non-string", [1]],
      ["unsupported scheme", ["ftp://app.example"]],
      ["path", ["https://app.example/path"]],
      ["malformed URL", ["::::"]],
      ["too many", Array.from({ length: 65 }, () => "https://app.example")],
    ])("rejects %s", (_name, value) => {
      vi.mocked(Environments.get).mockReturnValue(value);
      expect(() => Config.allowedOrigins()).toThrow(ConfigurationError);
    });
  });

  describe("statusCacheTtlSeconds", () => {
    it.each([
      [undefined, 0],
      ["", 0],
      ["0", 0],
      [" 120 ", 120],
      ["-1", 0],
      ["1.5", 0],
      ["abc", 0],
      ["100000", 86400],
    ])("maps %j to %d", (value, expected) => {
      vi.mocked(Environments.get).mockReturnValue(value);
      expect(Config.statusCacheTtlSeconds()).toBe(expected);
      expect(Environments.get).toHaveBeenCalledWith(
        "STATUS_CACHE_TTL_SECONDS",
        false,
      );
    });
  });

  describe("apiKeyCooldownSeconds", () => {
    it.each([
      [undefined, 60],
      ["", 60],
      ["   ", 60],
      ["0", 0],
      [" 120 ", 120],
      ["-1", 60],
      ["1.5", 60],
      ["abc", 60],
      ["100000", 86400],
    ])("maps %j to %d", (value, expected) => {
      vi.mocked(Environments.get).mockReturnValue(value);
      expect(Config.apiKeyCooldownSeconds()).toBe(expected);
      expect(Environments.get).toHaveBeenCalledWith(
        "API_KEY_COOLDOWN_SECONDS",
        false,
      );
    });
  });

  describe("customOpenAIEndpoints", () => {
    it("parses JSON strings", () => {
      vi.mocked(Environments.get).mockReturnValue(
        '[{"name":"local","baseUrl":"https://localhost"}]',
      );
      expect(Config.customOpenAIEndpoints()).toEqual([
        { name: "local", baseUrl: "https://localhost" },
      ]);
    });

    it("returns arrays unchanged", () => {
      const endpoints = [
        {
          name: "local",
          baseUrl: "https://localhost",
          apiKeys: ["key-1", "key-2"],
          models: ["model-1", "model-2"],
          chatCompletionPath: "/chat/completions",
          modelsPath: "/models",
        },
      ];
      vi.mocked(Environments.get).mockReturnValue(endpoints);
      expect(Config.customOpenAIEndpoints()).toBe(endpoints);
    });

    it("memoizes validated endpoints while the raw value is unchanged", () => {
      vi.mocked(Environments.get).mockReturnValue(
        '[{"name":"memoized","baseUrl":"https://memo.example"}]',
      );
      const first = Config.customOpenAIEndpoints();
      expect(first).toEqual([
        { name: "memoized", baseUrl: "https://memo.example" },
      ]);
      expect(Config.customOpenAIEndpoints()).toBe(first);
    });

    it.each([
      [{ name: "bad/name", baseUrl: "https://example.com" }],
      [{ name: "local", baseUrl: "http://example.com" }],
      [{ name: "local", baseUrl: "https://user:pass@example.com" }],
      [{ name: "local", baseUrl: "https://example.com?token=secret" }],
      [{ name: "local", baseUrl: "https://example.com#fragment" }],
      [{ name: "local", baseUrl: "not a URL" }],
      [{ name: "local", baseUrl: "https://example.com", models: [1] }],
      [{ name: "local", baseUrl: "https://example.com", models: [""] }],
      [
        {
          name: "local",
          baseUrl: "https://example.com",
          models: Array.from({ length: 1001 }, () => "model"),
        },
      ],
      [{ name: "local", baseUrl: "https://example.com", apiKeys: [""] }],
      [
        {
          name: "local",
          baseUrl: "https://example.com",
          apiKeys: Array.from({ length: 33 }, () => "key"),
        },
      ],
      [{ name: "local", baseUrl: "https://example.com", modelsPath: "models" }],
      [
        {
          name: "local",
          baseUrl: "https://example.com",
          modelsPath: `/${"x".repeat(2048)}`,
        },
      ],
      [{ name: "local", baseUrl: "https://example.com", apiKey: "typo" }],
      ["not-an-object"],
    ])("rejects unsafe custom endpoint configuration %s", (value) => {
      vi.mocked(Environments.get).mockReturnValue(value as never);
      expect(() => Config.customOpenAIEndpoints()).toThrow(ConfigurationError);
    });

    it.each([undefined, null])(
      "treats absent endpoint configuration %s as unconfigured",
      (value) => {
        vi.mocked(Environments.get).mockReturnValue(value as never);
        expect(Config.customOpenAIEndpoints()).toBeUndefined();
      },
    );

    it.each([42, { name: "invalid" }, "not-json"])(
      "rejects invalid endpoint configuration %s",
      (value) => {
        vi.mocked(Environments.get).mockReturnValue(value as never);
        expect(() => Config.customOpenAIEndpoints()).toThrow(
          "Invalid configuration for CUSTOM_OPENAI_ENDPOINTS.",
        );
      },
    );

    it("rejects duplicate and built-in custom endpoint names", () => {
      vi.mocked(Environments.get).mockReturnValue([
        { name: "duplicate", baseUrl: "https://first.example" },
        { name: "duplicate", baseUrl: "https://second.example" },
      ]);
      expect(() => Config.customOpenAIEndpoints()).toThrow(ConfigurationError);

      vi.mocked(Environments.get).mockReturnValue([
        { name: "openai", baseUrl: "https://custom.example" },
      ]);
      expect(() => Config.customOpenAIEndpoints()).toThrow(ConfigurationError);
    });

    it.each([
      [null],
      [{ name: "local", baseUrl: "http://example.com" }],
      [{ name: "local", baseUrl: "not a URL" }],
      [{ name: "local", baseUrl: "https://example.com", apiKeys: " " }],
    ])("deeply validates each custom endpoint: %s", (endpoint) => {
      vi.mocked(Environments.get).mockReturnValue([endpoint] as never);
      expect(() => Config.customOpenAIEndpoints()).toThrow(ConfigurationError);
    });

    it("accepts a non-empty scalar custom endpoint key", () => {
      vi.mocked(Environments.get).mockReturnValue([
        {
          name: "local",
          baseUrl: "https://example.com",
          apiKeys: "key",
        },
      ]);
      expect(Config.customOpenAIEndpoints()).toHaveLength(1);
    });

    it("accepts profiled custom endpoint keys", () => {
      const endpoints = [
        {
          name: "local",
          baseUrl: "https://example.com",
          apiKeys: { default: "key", paid: ["paid-1", "paid-2"] },
        },
      ];
      vi.mocked(Environments.get).mockReturnValue(endpoints);
      expect(Config.customOpenAIEndpoints()).toBe(endpoints);
    });

    it.each([
      {},
      { paid: 42 },
      { "bad/profile": "key" },
      { paid: [""] },
      Object.fromEntries(
        Array.from({ length: 33 }, (_, index) => [`profile-${index}`, "key"]),
      ),
    ])("rejects invalid custom endpoint key profiles: %j", (apiKeys) => {
      vi.mocked(Environments.get).mockReturnValue([
        { name: "local", baseUrl: "https://example.com", apiKeys },
      ] as never);
      expect(() => Config.customOpenAIEndpoints()).toThrow(ConfigurationError);
    });

    it("rejects more than sixteen custom endpoints", () => {
      vi.mocked(Environments.get).mockReturnValue(
        Array.from({ length: 17 }, (_, index) => ({
          name: `custom-${index}`,
          baseUrl: `https://custom-${index}.example`,
        })),
      );
      expect(() => Config.customOpenAIEndpoints()).toThrow(ConfigurationError);
    });
  });

  describe("virtualModels", () => {
    it("parses JSON strings", () => {
      vi.mocked(Environments.get).mockReturnValue(
        '{"virtual/fast-tier":["groq/llama-3.3-70b","openai/gpt-4o-mini"]}',
      );
      expect(Config.virtualModels()).toEqual({
        "virtual/fast-tier": [
          { model: "groq/llama-3.3-70b", retries: 0 },
          { model: "openai/gpt-4o-mini", retries: 0 },
        ],
      });
      expect(Environments.get).toHaveBeenCalledWith("VIRTUAL_MODELS", false);
    });

    it("normalizes object candidates and optional settings", () => {
      const routes = {
        "virtual/fast-tier": [
          {
            model: "groq/llama-3.3-70b",
            retries: 2,
            timeout: 5000,
          },
          { model: "openai/gpt-4o-mini" },
        ],
      };
      vi.mocked(Environments.get).mockReturnValue(routes as never);
      expect(Config.virtualModels()).toEqual({
        "virtual/fast-tier": [
          {
            model: "groq/llama-3.3-70b",
            retries: 2,
            timeout: 5000,
          },
          { model: "openai/gpt-4o-mini", retries: 0 },
        ],
      });
    });

    it("accepts arbitrary keys outside the virtual/ convention", () => {
      vi.mocked(Environments.get).mockReturnValue(
        '{"group/fast":["openai/gpt-4o-mini"],"my-alias":["groq/llama-3.3-70b"]}',
      );
      expect(Config.virtualModels()).toEqual({
        "group/fast": [{ model: "openai/gpt-4o-mini", retries: 0 }],
        "my-alias": [{ model: "groq/llama-3.3-70b", retries: 0 }],
      });
    });

    it("memoizes validated routes while the raw value is unchanged", () => {
      vi.mocked(Environments.get).mockReturnValue(
        '{"virtual/memo":["openai/gpt-4o-mini"]}',
      );
      const first = Config.virtualModels();
      expect(first).toEqual({
        "virtual/memo": [{ model: "openai/gpt-4o-mini", retries: 0 }],
      });
      expect(Config.virtualModels()).toBe(first);
    });

    it.each([undefined, null])(
      "treats absent virtual model configuration %s as unconfigured",
      (value) => {
        vi.mocked(Environments.get).mockReturnValue(value as never);
        expect(Config.virtualModels()).toBeUndefined();
      },
    );

    it.each([
      ["not-json"],
      [42],
      [["virtual/fast-tier"]],
      [{ "": ["openai/gpt-4o-mini"] }],
      [{ "virtual/fast tier": ["openai/gpt-4o-mini"] }],
      [{ [`virtual/${"a".repeat(129)}`]: ["openai/gpt-4o-mini"] }],
      [{ "virtual/fast-tier": [] }],
      [{ "virtual/fast-tier": "openai/gpt-4o-mini" }],
      [{ "virtual/fast-tier": ["openai/gpt-4o-mini", 42] }],
      [{ "virtual/fast-tier": ["not-a-provider-pair"] }],
      [{ "virtual/fast-tier": ["/gpt-4o-mini"] }],
      [{ "virtual/fast-tier": ["openai/"] }],
      [{ "virtual/fast-tier": [{}] }],
      [{ "virtual/fast-tier": [{ model: "openai/gpt", unknown: true }] }],
      [{ "virtual/fast-tier": [{ model: "openai/gpt", retries: -1 }] }],
      [{ "virtual/fast-tier": [{ model: "openai/gpt", retries: 1.5 }] }],
      [{ "virtual/fast-tier": [{ model: "openai/gpt", retries: 6 }] }],
      [{ "virtual/fast-tier": [{ model: "openai/gpt", timeout: 0 }] }],
      [{ "virtual/fast-tier": [{ model: "openai/gpt", timeout: 1.5 }] }],
      [{ "virtual/fast-tier": [{ model: "openai/gpt", timeout: 300_001 }] }],
      [{ "virtual/fast-tier": [{ model: "openai/gpt", timeout: "5000" }] }],
      [
        {
          "virtual/fast-tier": Array.from(
            { length: 17 },
            (_, index) => `openai/model-${index}`,
          ),
        },
      ],
      [
        Object.fromEntries(
          Array.from({ length: 101 }, (_, index) => [
            `virtual/route-${index}`,
            ["openai/gpt-4o-mini"],
          ]),
        ),
      ],
    ])("rejects unsafe virtual model configuration %j", (value) => {
      vi.mocked(Environments.get).mockReturnValue(value as never);
      expect(() => Config.virtualModels()).toThrow(ConfigurationError);
      expect(() => Config.virtualModels()).toThrow(
        "Invalid configuration for VIRTUAL_MODELS.",
      );
    });

    it("accepts references to another virtual model", () => {
      vi.mocked(Environments.get).mockReturnValue({
        "virtual/front": ["virtual/fallback"],
        "virtual/fallback": ["openai/gpt-4o-mini"],
      } as never);

      expect(Config.virtualModels()).toEqual({
        "virtual/front": [{ model: "virtual/fallback", retries: 0 }],
        "virtual/fallback": [{ model: "openai/gpt-4o-mini", retries: 0 }],
      });
    });

    it.each([
      {
        "virtual/self": ["virtual/self"],
      },
      {
        "virtual/one": ["virtual/two"],
        "virtual/two": ["virtual/three"],
        "virtual/three": ["virtual/one"],
      },
    ])("rejects circular virtual model references: %j", (value) => {
      vi.mocked(Environments.get).mockReturnValue(value as never);

      expect(() => Config.virtualModels()).toThrow(
        "Invalid configuration for VIRTUAL_MODELS.",
      );
    });

    it("does not treat a provider-shadowed virtual key as a graph edge", () => {
      vi.mocked(Environments.get).mockImplementation((name) =>
        name === "VIRTUAL_MODELS"
          ? ({ "custom/model": ["custom/model"] } as never)
          : ([{ name: "custom" }] as never),
      );

      expect(Config.virtualModels()).toEqual({
        "custom/model": [{ model: "custom/model", retries: 0 }],
      });
    });

    it("ignores malformed custom endpoint JSON while validating the graph", () => {
      vi.mocked(Environments.get).mockImplementation((name) =>
        name === "VIRTUAL_MODELS"
          ? ({ "virtual/route": ["openai/model"] } as never)
          : ("not-json" as never),
      );

      expect(Config.virtualModels()).toEqual({
        "virtual/route": [{ model: "openai/model", retries: 0 }],
      });
    });

    it("rejects a nested graph above the expanded attempt limit", () => {
      vi.mocked(Environments.get).mockReturnValue({
        "virtual/leaf": Array.from({ length: 16 }, (_, index) => ({
          model: `openai/model-${index}`,
          retries: 5,
        })),
        "virtual/root": ["virtual/leaf", "virtual/leaf"],
      } as never);

      expect(() => Config.virtualModels()).toThrow(
        "Invalid configuration for VIRTUAL_MODELS.",
      );
    });

    it("accepts the maximum number of routes and candidates", () => {
      vi.mocked(Environments.get).mockReturnValue(
        Object.fromEntries(
          Array.from({ length: 100 }, (_, index) => [
            `virtual/route-${index}`,
            Array.from({ length: 16 }, (_, i) =>
              i === 0
                ? {
                    model: `openai/model-${i}`,
                    retries: 5,
                    timeout: 300_000,
                  }
                : `openai/model-${i}`,
            ),
          ]),
        ) as never,
      );
      const virtualModels = Config.virtualModels()!;
      expect(Object.keys(virtualModels)).toHaveLength(100);
      expect(virtualModels["virtual/route-0"]).toHaveLength(16);
      expect(virtualModels["virtual/route-0"]?.[0]).toEqual({
        model: "openai/model-0",
        retries: 5,
        timeout: 300_000,
      });
    });
  });
});
