import { randomInt } from "node:crypto";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Config } from "~/src/utils/config";
import { Environments } from "~/src/utils/environments";
import { Secrets } from "~/src/utils/secrets";

vi.mock("node:crypto", () => ({
  randomInt: vi.fn(),
}));
vi.mock("~/src/utils/environments");
vi.mock("~/src/utils/config");

describe("Secrets", () => {
  let env: { [key: string]: string | string[] };

  beforeEach(() => {
    vi.clearAllMocks();
    env = {
      OPENAI_API_KEY: "openai-key",
      GEMINI_API_KEY: ["gemini-key1", "gemini-key2", "gemini-key3"],
    };

    vi.mocked(Environments.get).mockImplementation((keyName) => {
      return env[keyName];
    });

    vi.mocked(Config.isGlobalRoundRobinEnabled).mockReturnValue(false);
  });

  describe("getAll", () => {
    it("should return all secrets for a given key name", () => {
      const keys = Secrets.getAll("OPENAI_API_KEY");
      expect(keys).toEqual(["openai-key"]);
    });

    it("returns an empty list for absent and unsupported values", () => {
      expect(Secrets.getAll("ANTHROPIC_API_KEY")).toEqual([]);
      env.ANTHROPIC_API_KEY = 42 as never;
      expect(Secrets.getAll("ANTHROPIC_API_KEY")).toEqual([]);
    });

    it("shuffles only multi-key arrays when requested", () => {
      vi.mocked(randomInt).mockReturnValue(0 as never);
      const result = Secrets.getAll("GEMINI_API_KEY", true);
      expect(result).toHaveLength(3);
      expect(result).toEqual(
        expect.arrayContaining(["gemini-key1", "gemini-key2", "gemini-key3"]),
      );
      expect(Secrets.getAll("OPENAI_API_KEY", true)).toEqual(["openai-key"]);
    });
  });

  describe("get", () => {
    it("should return a single secret for a given key name with apiKeyIndex", () => {
      const key0 = Secrets.get("GEMINI_API_KEY", 0);
      const key1 = Secrets.get("GEMINI_API_KEY", 1);
      const key2 = Secrets.get("GEMINI_API_KEY", 2);
      expect(key0).toBe("gemini-key1");
      expect(key1).toBe("gemini-key2");
      expect(key2).toBe("gemini-key3");
    });

    it("should wrap around if apiKeyIndex exceeds length", () => {
      const key3 = Secrets.get("GEMINI_API_KEY", 3);
      expect(key3).toBe("gemini-key1");
    });

    it("returns an empty string when no keys exist", () => {
      expect(Secrets.get("ANTHROPIC_API_KEY")).toBe("");
    });
  });

  describe("getNext", () => {
    it("returns zero without consulting rotation for zero or one key", async () => {
      expect(await Secrets.getNext("ANTHROPIC_API_KEY")).toBe(0);
      expect(await Secrets.getNext("OPENAI_API_KEY")).toBe(0);
      expect(randomInt).not.toHaveBeenCalled();
    });

    it("uses random selection when the Durable Object binding is absent", async () => {
      vi.mocked(Config.isGlobalRoundRobinEnabled).mockReturnValue(true);
      vi.mocked(Environments.getEnv).mockReturnValue({} as Env);
      vi.mocked(randomInt).mockReturnValue(2 as never);

      expect(await Secrets.getNext("GEMINI_API_KEY")).toBe(2);
      expect(randomInt).toHaveBeenCalledWith(3);
    });
    it("should return a random apiKeyIndex if global round-robin is disabled", async () => {
      vi.mocked(Config.isGlobalRoundRobinEnabled).mockReturnValue(false);
      vi.mocked(randomInt).mockReturnValue(1 as any);
      const apiKeyIndex = await Secrets.getNext("GEMINI_API_KEY");
      expect(apiKeyIndex).toBe(1);
      expect(randomInt).toHaveBeenCalledWith(3);
    });

    it("should use global counter if global round-robin is enabled", async () => {
      vi.mocked(Config.isGlobalRoundRobinEnabled).mockReturnValue(true);

      const mockGetNextIndex = vi.fn().mockResolvedValue(1); // Return apiKeyIndex 1
      const mockEnv = {
        KEY_ROTATION_MANAGER: {
          idFromName: vi.fn().mockReturnValue("mock-id"),
          get: vi.fn().mockReturnValue({
            getNextIndex: mockGetNextIndex,
          }),
        },
      };

      vi.mocked(Environments.getEnv).mockReturnValue(mockEnv as any);

      const apiKeyIndex = await Secrets.getNext("GEMINI_API_KEY");
      expect(apiKeyIndex).toBe(1);
      expect(mockGetNextIndex).toHaveBeenCalledWith("GEMINI_API_KEY", 3);
    });
  });

  describe("resolveApiKeyIndex", () => {
    it("should return the index itself for numeric selection", () => {
      expect(Secrets.resolveApiKeyIndex(1, 3)).toBe(1);
      expect(Secrets.resolveApiKeyIndex(4, 3)).toBe(1); // 4 % 3 = 1
    });

    it("should return a random index within range for range selection", () => {
      vi.mocked(randomInt).mockReturnValue(2 as any);
      const index = Secrets.resolveApiKeyIndex({ start: 1, end: 3 }, 5);
      expect(index).toBe(2);
      expect(randomInt).toHaveBeenCalledWith(1, 4); // start=1, end=3 -> randomInt(1, 4)
    });

    it("should use length-1 as default for end", () => {
      vi.mocked(randomInt).mockReturnValue(4 as any);
      const index = Secrets.resolveApiKeyIndex({ start: 2 }, 5);
      expect(index).toBe(4);
      expect(randomInt).toHaveBeenCalledWith(2, 5); // start=2, end=undefined(4) -> randomInt(2, 5)
    });

    it("should use 0 as default for start", () => {
      vi.mocked(randomInt).mockReturnValue(1 as any);
      const index = Secrets.resolveApiKeyIndex({ end: 2 }, 5);
      expect(index).toBe(1);
      expect(randomInt).toHaveBeenCalledWith(0, 3); // start=undefined(0), end=2 -> randomInt(0, 3)
    });

    it("should return start if start >= end", () => {
      const index = Secrets.resolveApiKeyIndex({ start: 3, end: 1 }, 5);
      expect(index).toBe(3);
    });
  });
});
