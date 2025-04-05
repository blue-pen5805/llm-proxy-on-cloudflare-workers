import { describe, it, expect, beforeEach, vi } from "vitest";
import { Environments } from "~/src/utils/environments";
import { Secrets } from "~/src/utils/secrets";

vi.mock("~/src/utils/environments");

describe("Secrets", () => {
  let env: { [key: string]: string | string[] };

  beforeEach(() => {
    env = {
      OPENAI_API_KEY: "key1",
      GEMINI_API_KEY: ["key1", "key2", "key3"],
    };

    vi.mocked(Environments.get).mockImplementation((keyName) => {
      return env[keyName];
    });
  });

  it("should return all secrets for a given key name", () => {
    const keys = Secrets.getAll("OPENAI_API_KEY");
    expect(keys).toEqual(["key1"]);
  });

  it("should return a single secret for a given key name", () => {
    const key = Secrets.get("OPENAI_API_KEY", false);
    expect(key).toBe("key1");
  });

  it("should rotate secrets when requested", () => {
    const key1 = Secrets.get("GEMINI_API_KEY", true);
    const key2 = Secrets.get("GEMINI_API_KEY", true);
    expect(key2).not.toBe(key1);
    const key3 = Secrets.get("GEMINI_API_KEY", true);
    expect(key3).not.toBe(key1);
    expect(key3).not.toBe(key2);
    const key4 = Secrets.get("GEMINI_API_KEY", true);
    expect(key4).toBe(key1);
  });
});
