import { Context } from "hono";
import type { CloudflareAIGateway } from "~/src/ai_gateway";
import type {
  ProxyEnv,
  ProxyMiddleware,
  ProxyRequestState,
  RoutedRequestContext,
} from "~/src/request_context";
import routes from "~/src/routing";

/** Exercise a middleware with a real Hono Context and observable downstream response. */
export function testMiddleware(middleware: ProxyMiddleware) {
  return async (
    state: ProxyRequestState,
    next: () => Promise<Response | void>,
  ): Promise<Response> => {
    const c = new Context<ProxyEnv>(
      state.request ?? new Request("https://proxy.example.invalid/"),
      {
        env: state.env,
        executionCtx: state.ctx,
      },
    );
    c.set("proxy", state);
    const response = await middleware(c, async () => {
      const downstream = await next();
      if (downstream) c.res = downstream;
    });
    return response ?? c.res;
  };
}

/** Enter the authenticated Hono routing stage without mocking its router. */
export async function handleRouting(
  context: RoutedRequestContext,
  aiGateway?: CloudflareAIGateway,
): Promise<Response> {
  return await routes.fetch(
    context.request,
    { ...context, aiGateway },
    context.ctx,
  );
}
