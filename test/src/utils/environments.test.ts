import { afterEach, describe, test, expect, vi } from "vitest";
import { Environments } from "~/src/utils/environments";

// Mock the process.env
declare global {
  interface Env {
    TEST_VAR: string;
    JSON_OBJECT: string;
    JSON_ARRAY: string;
    JSON_NUMBER: string;
    JSON_LITERAL: string;
    QUOTED_STRING: string;
    MALFORMED_ARRAY: string;
    COMMA_SEPARATED: string;
    PLAIN_STRING: string;
  }
}

vi.mock("node:process", () => ({
  env: {
    TEST_VAR: "test-value",
    JSON_OBJECT: '{"key": "value"}',
    JSON_ARRAY: "[1, 2, 3]",
    JSON_NUMBER: "123",
    JSON_LITERAL: "true",
    QUOTED_STRING: '"quoted"',
    MALFORMED_ARRAY: "[not-json",
    COMMA_SEPARATED: "a, b, c",
    PLAIN_STRING: "plain string",
  },
}));

describe("Environments", () => {
  afterEach(() => {
    Environments.setEnv(undefined);
  });

  test("should expose an explicitly set Workers environment", () => {
    const env = { TEST_VAR: "worker-value" } as Env;
    Environments.setEnv(env);

    expect(Environments.getEnv()).toBe(env);
    expect(Environments.all()).toBe(env);
  });

  test("should isolate environments between concurrent async contexts", async () => {
    const envA = { TEST_VAR: "request-a" } as Env;
    const envB = { TEST_VAR: "request-b" } as Env;
    let releaseA: () => void = () => {};
    const waitForB = new Promise<void>((resolve) => {
      releaseA = resolve;
    });

    const requestA = Environments.run(envA, async () => {
      await waitForB;
      return Environments.get("TEST_VAR", false);
    });
    const requestB = Environments.run(envB, async () => {
      releaseA();
      await Promise.resolve();
      return Environments.get("TEST_VAR", false);
    });

    await expect(Promise.all([requestA, requestB])).resolves.toEqual([
      "request-a",
      "request-b",
    ]);
  });

  describe("all", () => {
    test("should return all environment variables", () => {
      const env = Environments.all();
      expect(env.TEST_VAR).toBe("test-value");
    });
  });

  describe("has", () => {
    test("should return true for existing variables", () => {
      expect(Environments.has("TEST_VAR")).toBe(true);
    });

    test("should return false for non-existing variables", () => {
      expect(Environments.has("NON_EXISTENT" as keyof Env)).toBe(false);
    });
  });

  describe("get", () => {
    test("should return  value when parse is false", () => {
      expect(Environments.get("JSON_OBJECT", false)).toBe('{"key": "value"}');
    });

    test("should return undefined for non-existing variables", () => {
      expect(
        Environments.get("NON_EXISTENT" as keyof Env, true),
      ).toBeUndefined();
    });

    test("should parse JSON objects", () => {
      const result = Environments.get("JSON_OBJECT");
      expect(result).toEqual({ key: "value" });
    });

    test("should parse JSON arrays", () => {
      const result = Environments.get("JSON_ARRAY", true);
      expect(result).toEqual([1, 2, 3]);
    });

    // Only an array or an object carries structure. Everything else is a
    // single credential and must reach the readers as the configured text: a
    // credential of digits alone that was coerced to a number got discarded by
    // the credential readers, silently disabling a configured provider.
    test.each([
      ["JSON_NUMBER", "123"],
      ["JSON_LITERAL", "true"],
      ["QUOTED_STRING", '"quoted"'],
      ["MALFORMED_ARRAY", "[not-json"],
      ["COMMA_SEPARATED", "a, b, c"],
    ])("keeps %s as one opaque secret", (name, value) => {
      expect(Environments.get(name as keyof Env, true)).toBe(value);
    });

    test("should memoize parsed values by raw value", () => {
      const first = Environments.get("COMMA_SEPARATED", true);
      const second = Environments.get("COMMA_SEPARATED", true);
      expect(second).toBe(first);
    });

    test("should keep parsing correctly after the bounded cache clears", () => {
      for (let index = 0; index < 513; index++) {
        Environments.setEnv({ TEST_VAR: `[${index}, 1]` } as Env);
        expect(Environments.get("TEST_VAR", true)).toEqual([index, 1]);
      }
      Environments.setEnv(undefined);
      expect(Environments.get("COMMA_SEPARATED", true)).toBe("a, b, c");
    });

    test("should return the original value if parsing fails", () => {
      const result = Environments.get("PLAIN_STRING", true);
      expect(result).toBe("plain string");
    });
  });
});
