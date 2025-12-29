import { Middleware } from "../middleware";
import { authenticate } from "../utils/authorization";
import { Config } from "../utils/config";
import { cleanPathname, getPathname } from "../utils/helpers";

export const authMiddleware: Middleware = async (context, next) => {
  context.pathname = cleanPathname(getPathname(context.request));

  if (!Config.isDevelopment() && authenticate(context.request) === false) {
    return new Response("Unauthorized", { status: 401 });
  }

  return await next();
};
