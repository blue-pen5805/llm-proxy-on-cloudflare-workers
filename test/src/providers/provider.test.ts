import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProviderBase } from "~/src/providers/provider";

vi.mock("~/src/utils", () => ({
  fetch2: vi.fn().mockImplementation(() => Promise.resolve(new Response())),
}));

describe("ProviderBase", () => {
  let providerBase: ProviderBase;

  beforeEach(() => {
    providerBase = new ProviderBase();
    // Mock methods that would normally be implemented by subclasses or depend on Secrets
    vi.spyOn(providerBase, "headers").mockResolvedValue({
      "Content-Type": "application/json",
    });
  });

  describe("available", () => {
    it("should return false by default (no apiKeyName)", () => {
      expect(providerBase.available()).toBe(false);
    });
  });

  describe("fetch", () => {
    it("should call its own headers method", async () => {
      const headersSpy = vi.spyOn(providerBase, "headers");
      await providerBase.buildChatCompletionsRequest({
        body: JSON.stringify({ messages: [] }),
        headers: {},
      });
      expect(headersSpy).toHaveBeenCalled();
    });
  });
});
