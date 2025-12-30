import { describe, it, expect, beforeEach, vi } from "vitest";
import { Config } from "~/src/utils/config";
import { Environments } from "~/src/utils/environments";
import { Secrets } from "~/src/utils/secrets";

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
    vi.spyOn(Math, "random").mockReturnValue(0.999);
  });

  describe("getAll", () => {
    it("should return all secrets for a given key name", () => {
      const keys = Secrets.getAll("OPENAI_API_KEY");
      expect(keys).toEqual(["openai-key"]);
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
  });

  describe("getNext", () => {
    it("should return a random apiKeyIndex if global round-robin is disabled", async () => {
      vi.mocked(Config.isGlobalRoundRobinEnabled).mockReturnValue(false);
      vi.spyOn(Math, "random").mockReturnValue(0.5); // (0.5 * 3) = 1.5 -> 1
      const apiKeyIndex = await Secrets.getNext("GEMINI_API_KEY");
      expect(apiKeyIndex).toBe(1);
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
});
