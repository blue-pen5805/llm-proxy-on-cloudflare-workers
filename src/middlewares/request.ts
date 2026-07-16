import { Middleware } from "../middleware";
import { getPathname } from "../utils/helpers";

export const requestMiddleware: Middleware = async (context, next) => {
  context.pathname = getPathname(context.request);

  return await next();
};
