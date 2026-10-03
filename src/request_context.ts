import type { Context, ExecutionContext, MiddlewareHandler } from "hono";
import type { CloudflareAIGateway } from "./ai_gateway";
import type { ProviderRegistry } from "./providers";

export type ApiKeySelection = number | { start?: number; end?: number };

/** Request-scoped state shared by Hono middleware and protocol handlers. */
export interface ProxyRequestState {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  pathname: string;
  aiGateway?: CloudflareAIGateway;
  apiKeyIndex?: ApiKeySelection;
  proxyKeyIndex?: number;
  providers?: ProviderRegistry;
}

/** State guaranteed to be available once request preparation reaches routing. */
export interface RoutedRequestContext extends ProxyRequestState {
  providers: ProviderRegistry;
}

/**
 * Refine the existing request object without allocating a second context.
 * The provider-registry middleware is the runtime owner of this invariant.
 */
export function assertRoutedRequestContext(
  context: ProxyRequestState,
): asserts context is RoutedRequestContext {
  if (!context.providers) {
    throw new Error("Request routing requires a provider registry.");
  }
}

/** Hono owns HTTP composition; protocol handlers share this request-local state. */
export type ProxyEnv = {
  Bindings: Env;
  Variables: { proxy: ProxyRequestState };
};
export type ProxyContext = Context<ProxyEnv>;
export type ProxyMiddleware = MiddlewareHandler<ProxyEnv>;
