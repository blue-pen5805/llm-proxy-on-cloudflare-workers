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
    it("should return array when PROXY_API_KEY is a string", () => {
      vi.mocked(Environments.get).mockReturnValue("test-key");

      const result = Config.apiKeys();

      expect(result).toEqual(["test-key"]);
      expect(Environments.get).toHaveBeenCalledWith("PROXY_API_KEY");
    });

    it("returns an empty array when PROXY_API_KEY is blank", () => {
      vi.mocked(Environments.get).mockReturnValue("   ");
      expect(Config.apiKeys()).toEqual([]);
    });

    it("should return array when PROXY_API_KEY is an array", () => {
      vi.mocked(Environments.get).mockReturnValue(["key1", "key2"]);

      const result = Config.apiKeys();

      expect(result).toEqual(["key1", "key2"]);
    });

    it("should return undefined when PROXY_API_KEY is undefined", () => {
      vi.mocked(Environments.get).mockReturnValue(undefined);

      const result = Config.apiKeys();

      expect(result).toBeUndefined();
    });

    it("should return undefined when PROXY_API_KEY is not a string or array", () => {
      vi.mocked(Environments.get).mockReturnValue(123);

      const result = Config.apiKeys();

      expect(result).toBeUndefined();
    });

    it("should return undefined when PROXY_API_KEY is an object", () => {
      vi.mocked(Environments.get).mockReturnValue({ key: "value" });

      const result = Config.apiKeys();

      expect(result).toBeUndefined();
    });

    it("should reject arrays containing non-string keys", () => {
      vi.mocked(Environments.get).mockReturnValue(["valid", 42]);
      expect(Config.apiKeys()).toBeUndefined();
    });

    it("should return undefined when PROXY_API_KEY is null", () => {
      vi.mocked(Environments.get).mockReturnValue(undefined);

      const result = Config.apiKeys();

      expect(result).toBeUndefined();
    });

    it("rejects an excessive number of proxy authentication keys", () => {
      vi.mocked(Environments.get).mockReturnValue(
        Array.from({ length: 65 }, (_, index) => `key-${index}`),
      );
      expect(Config.apiKeys()).toBeUndefined();
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

  describe("isGlobalRoundRobinEnabled", () => {
    it.each([
      ["true", true],
      ["false", false],
      [undefined, false],
    ])("maps %s to %s", (value, expected) => {
      vi.mocked(Environments.get).mockReturnValue(value);
      expect(Config.isGlobalRoundRobinEnabled()).toBe(expected);
      expect(Environments.get).toHaveBeenCalledWith(
        "ENABLE_GLOBAL_ROUND_ROBIN",
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
});
