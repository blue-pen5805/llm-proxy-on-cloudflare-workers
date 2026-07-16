import {
  getErrorMessage,
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
  });

  it("parses comments and trailing commas without corrupting strings", () => {
    expect(
      parseJsonc(`{
        // comment
        "url": "https://example.com/*literal*/",
      }`),
    ).toEqual({ url: "https://example.com/*literal*/" });
  });
});
