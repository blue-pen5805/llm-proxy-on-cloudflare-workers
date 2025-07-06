import { describe, it, expect, vi, beforeEach } from "vitest";
import { Config } from "~/src/utils/config";
import { Environments } from "~/src/utils/environments";

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

    it("should return true when DEV is any other string", () => {
      vi.mocked(Environments.get).mockReturnValue("development");

      const result = Config.isDevelopment();

      expect(result).toBe(true);
    });
  });

  describe("apiKeys", () => {
    it("should return array when PROXY_API_KEY is a string", () => {
      vi.mocked(Environments.get).mockReturnValue("test-key");

      const result = Config.apiKeys();

      expect(result).toEqual(["test-key"]);
      expect(Environments.get).toHaveBeenCalledWith("PROXY_API_KEY");
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

    it("should return undefined when PROXY_API_KEY is null", () => {
      vi.mocked(Environments.get).mockReturnValue(undefined);

      const result = Config.apiKeys();

      expect(result).toBeUndefined();
    });
  });

  describe("aiGateway", () => {
    it("should return AI Gateway configuration", () => {
      vi.mocked(Environments.get)
        .mockReturnValueOnce("test-account-id")
        .mockReturnValueOnce("test-gateway-name")
        .mockReturnValueOnce("test-token");

      const result = Config.aiGateway();

      expect(result).toEqual({
        accountId: "test-account-id",
        name: "test-gateway-name",
        token: "test-token",
      });
      expect(Environments.get).toHaveBeenCalledWith(
        "CLOUDFLARE_ACCOUNT_ID",
        false,
      );
      expect(Environments.get).toHaveBeenCalledWith("AI_GATEWAY_NAME", false);
      expect(Environments.get).toHaveBeenCalledWith("CF_AIG_TOKEN", false);
    });

    it("should return configuration with undefined values when not set", () => {
      vi.mocked(Environments.get).mockReturnValue(undefined);

      const result = Config.aiGateway();

      expect(result).toEqual({
        accountId: undefined,
        name: undefined,
        token: undefined,
      });
    });

    it("should handle mixed defined and undefined values", () => {
      vi.mocked(Environments.get)
        .mockReturnValueOnce("test-account-id")
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce("test-token");

      const result = Config.aiGateway();

      expect(result).toEqual({
        accountId: "test-account-id",
        name: undefined,
        token: "test-token",
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
});
