import { describe, expect, it, vi } from "vitest";
import { composeMiddleware, type MiddlewareContext } from "~/src/middleware";
import { NotFoundError } from "~/src/utils/error";

const context = {
  request: new Request("https://example.com"),
} as MiddlewareContext;

describe("composeMiddleware", () => {
  it("executes middleware in onion order", async () => {
    const calls: string[] = [];
    const pipeline = composeMiddleware([
      async (_context, next) => {
        calls.push("first:before");
        const response = await next();
        calls.push("first:after");
        return response;
      },
      async () => {
        calls.push("handler");
        return new Response("ok");
      },
    ]);

    const response = await pipeline(context);

    expect(await response.text()).toBe("ok");
    expect(calls).toEqual(["first:before", "handler", "first:after"]);
  });

  it("rejects when next is called more than once", async () => {
    let secondError: unknown;
    const pipeline = composeMiddleware([
      async (_context, next) => {
        await next();
        try {
          await next();
        } catch (error) {
          secondError = error;
        }
        return new Response("recovered");
      },
      async () => new Response("ok"),
    ]);

    await pipeline(context);
    expect(secondError).toEqual(new Error("next() called multiple times"));
  });

  it("throws NotFoundError when the pipeline has no terminal handler", async () => {
    expect(() => composeMiddleware([])(context)).toThrow(NotFoundError);
  });

  it("propagates synchronous middleware errors", async () => {
    const error = new Error("synchronous failure");
    const middleware = vi.fn(() => {
      throw error;
    });

    expect(() => composeMiddleware([middleware])(context)).toThrow(error);
  });
});
