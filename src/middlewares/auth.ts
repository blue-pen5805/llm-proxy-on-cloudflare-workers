import { Middleware } from "../middleware";
import { getAuthorizedProxyKeyIndex } from "../utils/authorization";
import { Config } from "../utils/config";
import { ServiceUnavailableError, UnauthorizedError } from "../utils/error";
import { removeAuthorizationQueryParameters } from "../utils/helpers";
import { RequestLogger } from "../utils/logger";

/**
 * Whether this invocation is running outside Cloudflare's edge.
 *
 * Cloudflare sets `cf-ray` on every request that reaches a deployed Worker, so
 * its absence identifies a local `wrangler dev` runtime. `DEV` disables client
 * authentication and the deployment helper never ships that binding; requiring
 * this runtime signal as well means a `DEV` value installed through any other
 * path — dashboard variable, `wrangler secret put`, infrastructure-as-code —
 * cannot turn a deployed Worker into an unauthenticated relay.
 */
function isLocalRuntime(request: Request): boolean {
  return request.headers.get("cf-ray") === null;
}

export const authMiddleware: Middleware = async (context, next) => {
  context.pathname = removeAuthorizationQueryParameters(context.pathname);

  if (Config.isDevelopment()) {
    if (isLocalRuntime(context.request)) {
      return await next();
    }
    RequestLogger.warn(
      "auth.development_mode_ignored",
      "DEV is set on a deployed Worker; client authentication stays enforced",
    );
  }

  const configuredKeys = Config.apiKeys();
  if (!configuredKeys || configuredKeys.length === 0) {
    throw new ServiceUnavailableError(
      "Proxy authentication is not configured.",
    );
  }

  const proxyKeyIndex = getAuthorizedProxyKeyIndex(
    context.request,
    configuredKeys,
  );
  if (proxyKeyIndex === undefined) {
    throw new UnauthorizedError();
  }
  context.proxyKeyIndex = proxyKeyIndex;
  RequestLogger.setProxyKeyIndex(proxyKeyIndex);

  return await next();
};
