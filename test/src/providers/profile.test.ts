import { describe, expect, it } from "vitest";
import {
  formatProviderSelector,
  parseProviderSelector,
} from "~/src/providers/profile";

describe("provider profile selectors", () => {
  it("parses default and named profiles", () => {
    expect(parseProviderSelector("ollama")).toEqual({
      providerName: "ollama",
      profile: "default",
    });
    expect(parseProviderSelector("ollama:paid")).toEqual({
      providerName: "ollama",
      profile: "paid",
    });
  });

  it.each(["", ":paid", "ollama:", "ollama:bad/profile", "ollama:a:b"])(
    "rejects invalid selector %j",
    (selector) => expect(parseProviderSelector(selector)).toBeUndefined(),
  );

  it("omits the default profile when formatting", () => {
    expect(formatProviderSelector("ollama", "default")).toBe("ollama");
    expect(formatProviderSelector("ollama", "paid")).toBe("ollama:paid");
  });
});
