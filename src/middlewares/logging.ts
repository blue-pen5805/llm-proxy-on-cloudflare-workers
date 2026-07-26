import { Middleware } from "../middleware";
import { RequestLogger } from "../utils/logger";

export const loggingMiddleware: Middleware = async (context, next) => {
  if (context.request.method === "OPTIONS") {
    RequestLogger.start();
  }
  const downstreamResponse = await next();

  RequestLogger.start();
  RequestLogger.info("request.completed", "Request completed", {
    ...RequestLogger.requestFields(),
    status: downstreamResponse.status,
    duration_ms: RequestLogger.requestDurationMs(),
  });

  return downstreamResponse;
};
