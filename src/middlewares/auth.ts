import { Middleware } from "../middleware";
import { authenticate } from "../utils/authorization";
import { Config } from "../utils/config";
import { UnauthorizedError } from "../utils/error";
import { cleanPathname, getPathname } from "../utils/helpers";

export const authMiddleware: Middleware = async (context, next) => {
  context.pathname = cleanPathname(getPathname(context.request));

  if (!Config.isDevelopment() && authenticate(context.request) === false) {
    throw new UnauthorizedError();
  }

  return await next();
};
