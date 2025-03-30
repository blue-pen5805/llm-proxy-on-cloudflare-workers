import { describe, it, expect, beforeEach } from "vitest";
import { Secrets } from "~/src/secrets";

describe("Secrets", () => {
  let env: Env;

  beforeEach(() => {
    env = {
      OPENAI_API_KEY: "key1",
      GEMINI_API_KEY: '["key1", "key2", "key3"]',
    } as Env;
    Secrets.configure(env);
  });

  it("should configure environment", () => {
    expect(Secrets.env).toBe(env);
  });

  it("should return available secrets", () => {
    const availableKeys = Secrets.availables();
    expect(availableKeys.sort()).toEqual(
      ["OPENAI_API_KEY", "GEMINI_API_KEY"].sort(),
    );
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

  it("should check if a key is available", () => {
    expect(Secrets.isAvailable("OPENAI_API_KEY")).toBe(true);
    expect(Secrets.isAvailable("NONEXISTENT_KEY" as any)).toBe(false);
  });

  it("should return false when env is undefined", () => {
    Secrets.env = undefined;
    expect(Secrets.isAvailable("OPENAI_API_KEY")).toBe(false);
  });
});
