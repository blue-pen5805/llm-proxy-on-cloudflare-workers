import { CloudflareAIGateway } from "./ai_gateway";

export interface MiddlewareContext {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  pathname: string;
  aiGateway?: CloudflareAIGateway;
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
        return Promise.resolve(new Response("Not Found", { status: 404 }));
      }
      try {
        return Promise.resolve(fn(context, dispatch.bind(null, i + 1)));
      } catch (err) {
        return Promise.reject(err);
      }
    }

    return dispatch(0);
  };
}
