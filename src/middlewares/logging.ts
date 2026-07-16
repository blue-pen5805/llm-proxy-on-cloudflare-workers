import { Middleware } from "../middleware";
import { RequestLogger } from "../utils/logger";

export const loggingMiddleware: Middleware = async (_context, next) => {
  const response = await next();

  RequestLogger.info("request.completed", {
    ...RequestLogger.requestFields(),
    status: response.status,
    duration_ms: RequestLogger.requestDurationMs(),
  });

  return response;
};
