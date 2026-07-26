import { Middleware } from "../middleware";
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
    return addCorsHeaders(
      context.request,
      new Response(
        JSON.stringify({
          error: {
            message,
            status,
          },
        }),
        {
          status,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );
  }
};
