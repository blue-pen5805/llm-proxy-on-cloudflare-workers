import { Middleware } from "../middleware";
import {
  anthropicErrorResponse,
  openAIErrorResponse,
} from "../requests/error_response";
import { addCorsHeaders } from "../requests/options";
import { AppError } from "../utils/error";
import { RequestLogger } from "../utils/logger";

export const errorMiddleware: Middleware = async (context, next) => {
  try {
    return await next();
  } catch (err) {
    let status = 500;
    let message = "Internal Server Error";

    RequestLogger.start();
    if (err instanceof AppError) {
      status = err.status;
      message = err.message;
    } else {
      RequestLogger.error(
        "request.unhandled_error",
        "Request failed with an unhandled error",
        err,
      );
    }

    // This middleware wraps CORS handling, so the error response adds the CORS
    // headers itself instead of relying on an inner middleware that was
    // bypassed by the throw.
    const path = (
      context.pathname || new URL(context.request.url).pathname
    ).split("?")[0];
    const response = /\/(?:v1\/)?messages(?:\/count_tokens)?$/.test(path)
      ? anthropicErrorResponse(message, status)
      : openAIErrorResponse(message, status);
    response.headers.set("Cache-Control", "no-store");
    // RFC 9110 requires a challenge on every 401. The scheme alone is the whole
    // contract here; no realm is advertised because it would name the
    // deployment without helping any client choose a credential.
    if (status === 401) {
      response.headers.set("WWW-Authenticate", "Bearer");
    }
    return addCorsHeaders(context.request, response);
  }
};
