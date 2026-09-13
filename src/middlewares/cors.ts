import type { ProxyMiddleware } from "../request_context";
import { applyCorsHeaders, handleOptions } from "../requests/options";

export const corsMiddleware: ProxyMiddleware = async (c, next) => {
  const context = c.get("proxy");
  if (context.request.method === "OPTIONS") {
    return handleOptions(context.request);
  }
  await next();
  // Hono onError already applies CORS to error responses.
  if (!c.error && context.request.headers.has("Origin")) {
    // Hono's response setter merges old headers, including upstream CORS.
    // header() makes immutable upstream headers writable; apply policy in place.
    c.header("Access-Control-Allow-Origin", undefined);
    applyCorsHeaders(context.request, c.res.headers);
  }
};
