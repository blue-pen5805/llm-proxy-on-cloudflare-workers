import { Middleware } from "../middleware";
import { Environments } from "../utils/environments";
import { getPathname } from "../utils/helpers";

export const requestMiddleware: Middleware = async (context, next) => {
  context.pathname = getPathname(context.request);
  Environments.setEnv(context.env);

  return await next();
};
