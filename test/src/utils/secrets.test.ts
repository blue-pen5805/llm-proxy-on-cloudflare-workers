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
    // Clear static cache in Secrets
    Object.keys(Secrets.loaded).forEach((key) => delete Secrets.loaded[key]);
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
    it("should return a single secret for a given key name", () => {
      const key = Secrets.get("OPENAI_API_KEY", false);
      expect(key).toBe("openai-key");
    });

    it("should rotate secrets when requested (local round-robin)", () => {
      const key1 = Secrets.get("GEMINI_API_KEY", true);
      const key2 = Secrets.get("GEMINI_API_KEY", true);
      expect(key1).toBe("gemini-key1");
      expect(key2).toBe("gemini-key2");

      const key3 = Secrets.get("GEMINI_API_KEY", true);
      expect(key3).toBe("gemini-key3");

      const key4 = Secrets.get("GEMINI_API_KEY", true);
      expect(key4).toBe("gemini-key1");
    });
  });

  describe("getAsync", () => {
    it("should fall back to local rotation if global round-robin is disabled", async () => {
      vi.mocked(Config.isGlobalRoundRobinEnabled).mockReturnValue(false);
      const key = await Secrets.getAsync("GEMINI_API_KEY");
      expect(key).toBe("gemini-key1");
    });

    it("should use global counter if global round-robin is enabled", async () => {
      vi.mocked(Config.isGlobalRoundRobinEnabled).mockReturnValue(true);

      const mockGetNextIndex = vi.fn().mockResolvedValue(1); // Return index 1
      const mockEnv = {
        KEY_ROTATION_MANAGER: {
          idFromName: vi.fn().mockReturnValue("mock-id"),
          get: vi.fn().mockReturnValue({
            getNextIndex: mockGetNextIndex,
          }),
        },
      };

      vi.mocked(Environments.getEnv).mockReturnValue(mockEnv as any);

      const key = await Secrets.getAsync("GEMINI_API_KEY");
      expect(key).toBe("gemini-key2");
      expect(mockGetNextIndex).toHaveBeenCalledWith("GEMINI_API_KEY", 3);
    });
  });
});
