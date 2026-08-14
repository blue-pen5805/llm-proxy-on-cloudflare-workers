import type { MiddlewareContext } from "./request_context";
import { NotFoundError } from "./utils/error";

export type { MiddlewareContext } from "./request_context";

type NextFunction = () => Promise<Response>;

export type Middleware = (
  context: MiddlewareContext,
  next: NextFunction,
) => Promise<Response>;

/**
 * Composes multiple middlewares into a single middleware-like function.
 */
export function composeMiddleware(
  middlewares: Middleware[],
): (context: MiddlewareContext) => Promise<Response> {
  return function (context: MiddlewareContext): Promise<Response> {
    let lastDispatchedIndex = -1;

    function dispatchMiddleware(middlewareIndex: number): Promise<Response> {
      if (middlewareIndex <= lastDispatchedIndex) {
        return Promise.reject(new Error("next() called multiple times"));
      }
      lastDispatchedIndex = middlewareIndex;
      const middleware = middlewares[middlewareIndex];
      if (middlewareIndex === middlewares.length) {
        throw new NotFoundError();
      }
      return middleware(context, () => dispatchMiddleware(middlewareIndex + 1));
    }

    return dispatchMiddleware(0);
  };
}
