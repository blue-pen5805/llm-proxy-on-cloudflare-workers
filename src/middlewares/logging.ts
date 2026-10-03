import type { ProxyMiddleware } from "../request_context";
import { RequestLogger } from "../utils/logger";

export const loggingMiddleware: ProxyMiddleware = async (c, next) => {
  const context = c.get("proxy");
  if (context.request.method === "OPTIONS") {
    RequestLogger.start();
  }
  await next();

  RequestLogger.start();
  RequestLogger.info("request.completed", "Request completed", {
    ...RequestLogger.requestFields(),
    status: c.res.status,
    duration_ms: RequestLogger.requestDurationMs(),
  });
};
