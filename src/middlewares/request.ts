import { Middleware } from "../middleware";
import { getRequestPath } from "../utils/helpers";
import { RequestLogger } from "../utils/logger";

export const requestMiddleware: Middleware = async (context, next) => {
  // RequestLogger already parses the URL for every invocation.
  context.pathname =
    RequestLogger.requestPath() ?? getRequestPath(context.request);

  return await next();
};
