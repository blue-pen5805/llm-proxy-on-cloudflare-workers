import { describe, expect, it } from "vitest";
import {
  assertRoutedRequestContext,
  type MiddlewareContext,
} from "~/src/request_context";
import { createTestRoutedContext } from "../helpers/request_context";

describe("request context", () => {
  it("accepts state prepared for routing", () => {
    const context = createTestRoutedContext();

    expect(() => assertRoutedRequestContext(context)).not.toThrow();
  });

  it("rejects state that reached routing without a provider registry", () => {
    const routed = createTestRoutedContext();
    const context: MiddlewareContext = {
      request: routed.request,
      env: routed.env,
      ctx: routed.ctx,
      pathname: routed.pathname,
    };

    expect(() => assertRoutedRequestContext(context)).toThrow(
      "Request routing requires a provider registry.",
    );
  });
});
