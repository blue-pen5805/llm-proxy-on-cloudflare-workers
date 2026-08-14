import type { CloudflareAIGateway } from "./ai_gateway";
import type { ProviderRegistry } from "./providers";

export type ApiKeySelection = number | { start?: number; end?: number };

/** Request-scoped state while the ordered middleware pipeline is running. */
export interface MiddlewareContext {
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
export interface RoutedRequestContext extends MiddlewareContext {
  providers: ProviderRegistry;
}

/**
 * Refine the existing request object without allocating a second context.
 * The provider-registry middleware is the runtime owner of this invariant.
 */
export function assertRoutedRequestContext(
  context: MiddlewareContext,
): asserts context is RoutedRequestContext {
  if (!context.providers) {
    throw new Error("Request routing requires a provider registry.");
  }
}
