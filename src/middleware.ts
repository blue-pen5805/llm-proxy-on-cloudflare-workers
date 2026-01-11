import { CloudflareAIGateway } from "./ai_gateway";
import { NotFoundError } from "./utils/error";

export interface MiddlewareContext {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  pathname: string;
  aiGateway?: CloudflareAIGateway;
  apiKeyIndex?: number | { start?: number; end?: number };
}

export type NextFunction = () => Promise<Response>;

export type Middleware = (
  context: MiddlewareContext,
  next: NextFunction,
) => Promise<Response>;

/**
 * Composes multiple middlewares into a single middleware-like function.
 */
export function compose(
  middlewares: Middleware[],
): (context: MiddlewareContext) => Promise<Response> {
  return function (context: MiddlewareContext): Promise<Response> {
    let index = -1;

    function dispatch(i: number): Promise<Response> {
      if (i <= index) {
        return Promise.reject(new Error("next() called multiple times"));
      }
      index = i;
      const fn = middlewares[i];
      if (i === middlewares.length) {
        throw new NotFoundError();
      }
      try {
        return fn(context, dispatch.bind(null, i + 1));
      } catch (err) {
        throw err;
      }
    }

    return dispatch(0);
  };
}
