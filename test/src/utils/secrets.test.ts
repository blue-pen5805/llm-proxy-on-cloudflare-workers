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

    it("filters blank strings without changing configured credential values", () => {
      env.ANTHROPIC_API_KEY = ["", "   ", "\t", " key-with-padding "];
      env.OPENAI_API_KEY = " \n ";

      expect(Secrets.getAll("ANTHROPIC_API_KEY")).toEqual([
        " key-with-padding ",
      ]);
      expect(Secrets.getAll("OPENAI_API_KEY")).toEqual([]);
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

    it("should return a random apiKeyIndex if round-robin is disabled", async () => {
      vi.mocked(Config.isGlobalRoundRobinEnabled).mockReturnValue(false);
      vi.mocked(randomInt).mockReturnValue(1 as any);
      const apiKeyIndex = await Secrets.getNext("GEMINI_API_KEY");
      expect(apiKeyIndex).toBe(1);
      expect(randomInt).toHaveBeenCalledWith(3);
    });

    it("rotates sequentially from a random phase when round-robin is enabled", async () => {
      vi.mocked(Config.isGlobalRoundRobinEnabled).mockReturnValue(true);
      vi.mocked(randomInt).mockReturnValue(2 as never);

      // The random phase is drawn once per identifier; later calls advance
      // the isolate-local counter without touching the random source again.
      expect(await Secrets.getNextIndex("striped-rotation", 3)).toBe(2);
      expect(randomInt).toHaveBeenCalledTimes(1);
      expect(await Secrets.getNextIndex("striped-rotation", 3)).toBe(0);
      expect(await Secrets.getNextIndex("striped-rotation", 3)).toBe(1);
      expect(await Secrets.getNextIndex("striped-rotation", 3)).toBe(2);
      expect(randomInt).toHaveBeenCalledTimes(1);
    });

    it("keeps independent rotation counters per identifier", async () => {
      vi.mocked(Config.isGlobalRoundRobinEnabled).mockReturnValue(true);
      vi.mocked(randomInt).mockReturnValue(0 as never);

      expect(await Secrets.getNextIndex("striped-first", 2)).toBe(0);
      expect(await Secrets.getNextIndex("striped-second", 2)).toBe(0);
      expect(await Secrets.getNextIndex("striped-first", 2)).toBe(1);
      expect(await Secrets.getNextIndex("striped-second", 2)).toBe(1);
    });

    it("resets a stored counter that exceeds a shrunken key array", async () => {
      vi.mocked(Config.isGlobalRoundRobinEnabled).mockReturnValue(true);
      vi.mocked(randomInt).mockReturnValue(4 as never);

      expect(await Secrets.getNextIndex("striped-bounded", 5)).toBe(4);
      // The stored counter is now 0; advance twice so it holds 2, then
      // shrink the key array so the stored value is out of range and must
      // reset to index zero.
      expect(await Secrets.getNextIndex("striped-bounded", 5)).toBe(0);
      expect(await Secrets.getNextIndex("striped-bounded", 5)).toBe(1);
      expect(await Secrets.getNextIndex("striped-bounded", 2)).toBe(0);
    });

    it("advances rotation through getNext for configured key names", async () => {
      vi.mocked(Config.isGlobalRoundRobinEnabled).mockReturnValue(true);
      vi.mocked(randomInt).mockReturnValue(0 as never);

      const firstIndex = await Secrets.getNext("GEMINI_API_KEY");
      const secondIndex = await Secrets.getNext("GEMINI_API_KEY");
      expect(secondIndex).toBe((firstIndex + 1) % 3);
    });
  });

  describe("resolveApiKeyIndex", () => {
    it("returns zero for an empty or single-key credential set", () => {
      expect(Secrets.resolveApiKeyIndex(99, 0)).toBe(0);
      expect(Secrets.resolveApiKeyIndex({ start: 99 }, 1)).toBe(0);
    });

    it("should return the index itself for numeric selection", () => {
      expect(Secrets.resolveApiKeyIndex(1, 3)).toBe(1);
      expect(Secrets.resolveApiKeyIndex(4, 3)).toBe(1); // 4 % 3 = 1
      expect(Secrets.resolveApiKeyIndex(-1, 3)).toBe(0);
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
