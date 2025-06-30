import { describe, test, expect, beforeEach, vi } from "vitest";
import { Environments } from "~/src/utils/environments";

// Mock the process.env
declare global {
  interface Env {
    TEST_VAR: string;
    JSON_OBJECT: string;
    JSON_ARRAY: string;
    JSON_NUMBER: string;
    COMMA_SEPARATED: string;
    PLAIN_STRING: string;
  }
}

describe("Environments", () => {
  beforeEach(() => {
    vi.mock("node:process", () => {
      return {
        env: {
          TEST_VAR: "test-value",
          JSON_OBJECT: '{"key": "value"}',
          JSON_ARRAY: "[1, 2, 3]",
          JSON_NUMBER: "123",
          COMMA_SEPARATED: "a, b, c",
          PLAIN_STRING: "plain string",
        },
      };
    });
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
      const result = Environments.get("JSON_OBJECT", true);
      expect(result).toEqual({ key: "value" });
    });

    test("should parse JSON arrays", () => {
      const result = Environments.get("JSON_ARRAY", true);
      expect(result).toEqual([1, 2, 3]);
    });

    test("should parse JSON numbers", () => {
      const result = Environments.get("JSON_NUMBER", true);
      expect(result).toBe(123);
    });

    test("should parse comma-separated values", () => {
      const result = Environments.get("COMMA_SEPARATED", true);
      expect(result).toEqual(["a", "b", "c"]);
    });

    test("should return the original value if parsing fails", () => {
      const result = Environments.get("PLAIN_STRING", true);
      expect(result).toBe("plain string");
    });
  });
});
