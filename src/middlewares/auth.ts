import { Middleware } from "../middleware";
import { isRequestAuthorized } from "../utils/authorization";
import { Config } from "../utils/config";
import { ServiceUnavailableError, UnauthorizedError } from "../utils/error";
import { removeAuthorizationQueryParameters } from "../utils/helpers";

export const authMiddleware: Middleware = async (context, next) => {
  context.pathname = removeAuthorizationQueryParameters(context.pathname);

  if (Config.isDevelopment()) {
    return await next();
  }

  const configuredKeys = Config.apiKeys();
  if (!configuredKeys || configuredKeys.length === 0) {
    throw new ServiceUnavailableError(
      "Proxy authentication is not configured.",
    );
  }

  if (isRequestAuthorized(context.request, configuredKeys) === false) {
    throw new UnauthorizedError();
  }

  return await next();
};
