import {
  getErrorMessage,
  parseEnvironmentCliArguments,
  parseJsonc,
  validateEnvironmentName,
} from "../../scripts/utils";
import { describe, expect, it } from "vitest";

describe("script utilities", () => {
  it("normalizes Error and non-Error exception values", () => {
    expect(getErrorMessage(new Error("failed"))).toBe("failed");
    expect(getErrorMessage("failed")).toBe("failed");
  });

  it("validates safe environment suffixes", () => {
    expect(validateEnvironmentName("prod-blue_2")).toBe(true);
    expect(validateEnvironmentName("prod.blue")).toBe(false);
    expect(validateEnvironmentName("prod blue")).toBe(false);
    expect(validateEnvironmentName("")).toBe(false);
  });

  // Every CLI parses its options through this one function, so the shared
  // option grammar is asserted here instead of once per command.
  describe("parseEnvironmentCliArguments", () => {
    it("parses environment, help, and declared boolean flags", () => {
      expect(parseEnvironmentCliArguments([])).toEqual({ flags: new Set() });
      expect(parseEnvironmentCliArguments(["--env", "staging"])).toEqual({
        env: "staging",
        flags: new Set(),
      });
      expect(parseEnvironmentCliArguments(["--help"])).toEqual({
        help: true,
        flags: new Set(),
      });
      expect(parseEnvironmentCliArguments(["-h"])).toEqual({
        help: true,
        flags: new Set(),
      });
      expect(
        parseEnvironmentCliArguments(
          ["--env", "prod", "--dry-run", "--help"],
          ["--dry-run"],
        ),
      ).toEqual({
        env: "prod",
        help: true,
        flags: new Set(["--dry-run"]),
      });
    });

    it("rejects unknown options, stray arguments, and a valueless --env", () => {
      expect(() => parseEnvironmentCliArguments(["--invalid"])).toThrow(
        "Unknown option: --invalid",
      );
      expect(() => parseEnvironmentCliArguments(["--dry-run"])).toThrow(
        "Unknown option: --dry-run",
      );
      expect(() => parseEnvironmentCliArguments(["config.jsonc"])).toThrow(
        "Unexpected argument: config.jsonc",
      );
      expect(() => parseEnvironmentCliArguments(["--env"])).toThrow(
        "--env option requires a value",
      );
      expect(() => parseEnvironmentCliArguments(["--env", "--help"])).toThrow(
        "--env option requires a value",
      );
    });
  });

  it("parses comments and trailing commas without corrupting strings", () => {
    expect(
      parseJsonc(`{
        // comment
        "url": "https://example.com/*literal*/",
      }`),
    ).toEqual({ url: "https://example.com/*literal*/" });
  });

  it("preserves a credential containing a comma before a closing brace", () => {
    // Stripping trailing commas with a regular expression rewrote this value
    // to "abc }", so a correct credential was deployed corrupted.
    expect(parseJsonc('{"PROXY_API_KEY": "abc, }"}')).toEqual({
      PROXY_API_KEY: "abc, }",
    });
    expect(parseJsonc('{"DEFAULT_MODEL": "a, ]"}')).toEqual({
      DEFAULT_MODEL: "a, ]",
    });
  });

  it("rejects malformed JSONC and non-object documents", () => {
    expect(() => parseJsonc("{")).toThrow("not valid JSONC");
    expect(() => parseJsonc('{"a": 1,, }')).toThrow("not valid JSONC");
    expect(() => parseJsonc("[1, 2]")).toThrow("must be a JSON object");
    expect(() => parseJsonc('"text"')).toThrow("must be a JSON object");
  });
});
