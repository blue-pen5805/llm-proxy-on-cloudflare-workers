import { describe, expect, it, vi } from "vitest";
import { resolveRoute } from "~/src/routing";
import { createTestRoutedContext } from "../helpers/request_context";

describe("resolveRoute", () => {
  it("returns a route descriptor without invoking request execution", () => {
    const context = createTestRoutedContext({
      request: new Request("https://example.com/v1/responses", {
        method: "POST",
      }),
      pathname: "/v1/responses",
    });
    const providerMatch = vi.spyOn(context.providers, "match");

    expect(resolveRoute(context, false)).toEqual({ kind: "responses" });
    expect(providerMatch).not.toHaveBeenCalled();
  });

  it("captures provider pass-through parameters in the descriptor", () => {
    const context = createTestRoutedContext({
      request: new Request("https://example.com/openai/v1/models"),
      pathname: "/openai/v1/models?limit=2",
    });

    expect(resolveRoute(context, false)).toEqual({
      kind: "provider_proxy",
      providerName: "openai",
      pathname: "/v1/models?limit=2",
    });
  });
});
