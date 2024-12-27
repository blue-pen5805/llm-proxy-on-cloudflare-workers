import { describe, it, expect } from "vitest";
import {
  safeJsonParse,
  getPathname,
  shuffle,
  formatString,
} from "../src/utils";

describe("safeJsonParse", () => {
  it("should parse valid JSON string", () => {
    const jsonString = '{"key": "value"}';
    const result = safeJsonParse(jsonString);
    expect(result).toEqual({ key: "value" });
  });

  it("should return the original string if JSON is invalid", () => {
    const invalidJsonString = "invalid json";
    const result = safeJsonParse(invalidJsonString);
    expect(result).toBe(invalidJsonString);
  });
});

describe("getPathname", () => {
  it("should return the pathname of the URL", () => {
    const request = new Request("https://example.com/pathname");
    const result = getPathname(request);
    expect(result).toBe("/pathname");
  });
});

describe("shuffle", () => {
  it("should shuffle the array", () => {
    const array = [1, 2, 3, 4, 5];
    const result = shuffle(array);
    expect(result).not.toEqual(array); // It's possible to get the same array, but very unlikely
    expect(result.sort()).toEqual(array.sort()); // Ensure all elements are still present
  });
});

describe("formatString", () => {
  it("should format the string with the given arguments", () => {
    const template = "Hello, {name}!";
    const args = { name: "World" };
    const result = formatString(template, args);
    expect(result).toBe("Hello, World!");
  });

  it("should replace multiple occurrences of the same key", () => {
    const template = "{greeting}, {name}! {greeting} again!";
    const args = { greeting: "Hello", name: "World" };
    const result = formatString(template, args);
    expect(result).toBe("Hello, World! Hello again!");
  });
});
