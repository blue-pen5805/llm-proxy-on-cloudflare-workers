import { Middleware } from "../middleware";
import { isRequestAuthorized } from "../utils/authorization";
import { Config } from "../utils/config";
import { UnauthorizedError } from "../utils/error";
import { removeAuthorizationQueryParameters } from "../utils/helpers";

export const authMiddleware: Middleware = async (context, next) => {
  context.pathname = removeAuthorizationQueryParameters(context.pathname);

  if (
    !Config.isDevelopment() &&
    isRequestAuthorized(context.request) === false
  ) {
    throw new UnauthorizedError();
  }

  return await next();
};
