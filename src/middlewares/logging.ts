import { Middleware } from "../middleware";
import { RequestLogger } from "../utils/logger";

export const loggingMiddleware: Middleware = async (_context, next) => {
  const downstreamResponse = await next();

  RequestLogger.info("request.completed", "Request completed", {
    ...RequestLogger.requestFields(),
    status: downstreamResponse.status,
    duration_ms: RequestLogger.requestDurationMs(),
  });

  return downstreamResponse;
};
