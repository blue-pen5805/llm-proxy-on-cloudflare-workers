import { Middleware } from "../middleware";
import { handleOptions } from "../requests/options";

export const corsMiddleware: Middleware = async (context, next) => {
  if (context.request.method === "OPTIONS") {
    return handleOptions(context.request);
  }
  return await next();
};
