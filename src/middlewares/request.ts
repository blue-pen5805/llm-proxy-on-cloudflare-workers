import { Middleware } from "../middleware";
import { getRequestPath } from "../utils/helpers";

export const requestMiddleware: Middleware = async (context, next) => {
  context.pathname = getRequestPath(context.request);

  return await next();
};
