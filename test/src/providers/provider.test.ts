import { describe, it, expect, vi, beforeEach } from "vitest";
import { createProvider, ProviderBase } from "~/src/providers/provider";

vi.mock("~/src/utils", () => ({
  fetchWithLogging: vi
    .fn()
    .mockImplementation(() => Promise.resolve(new Response())),
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

    it("builds request init with provider headers", async () => {
      const init = await providerBase.buildRequestInit({
        method: "POST",
        headers: { "X-Request": "test" },
      });
      expect(init.method).toBe("POST");
      expect(new Headers(init.headers)).toEqual(
        new Headers({
          "content-type": "application/json",
          "x-request": "test",
        }),
      );
    });
  });
});

describe("createProvider defaults", () => {
  it("creates a provider without a definition", () => {
    const provider = createProvider();
    expect(provider.baseUrl()).toBe("https://example.com");
    expect(provider.pathnamePrefix()).toBe("");
  });

  it("uses a pathname-prefix hook", () => {
    expect(
      createProvider({ pathnamePrefix: () => "/hook" }).pathnamePrefix(),
    ).toBe("/hook");
  });
});
