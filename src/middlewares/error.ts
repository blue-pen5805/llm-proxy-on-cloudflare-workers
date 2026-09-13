import type { ProxyMiddleware, ProxyContext } from "../request_context";
import {
  anthropicErrorResponse,
  openAIErrorResponse,
} from "../requests/error_response";
import { addCorsHeaders } from "../requests/options";
import { AppError, MethodNotAllowedError } from "../utils/error";
import { RequestLogger } from "../utils/logger";

export function errorResponse(err: unknown, c: ProxyContext): Response {
  const context = c.get("proxy");
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

  // Errors from CORS itself also need the applicable cross-origin headers.
  // Successful Hono error handling bypasses the normal CORS response mutation.
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
  if (err instanceof MethodNotAllowedError) {
    response.headers.set("Allow", err.allowedMethods.join(", "));
  }
  return addCorsHeaders(context.request, response);
}

// Hono handles Error instances with onError; this boundary also contains values
// thrown by upstream/runtime code that are not Error instances.
export const errorMiddleware: ProxyMiddleware = async (c, next) => {
  try {
    await next();
  } catch (err) {
    return errorResponse(err, c);
  }
};
