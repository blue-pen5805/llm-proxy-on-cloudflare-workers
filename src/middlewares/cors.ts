import { Middleware } from "../middleware";
import { addCorsHeaders, handleOptions } from "../requests/options";

export const corsMiddleware: Middleware = async (context, next) => {
  if (context.request.method === "OPTIONS") {
    return handleOptions(context.request);
  }
  return addCorsHeaders(context.request, await next());
};
