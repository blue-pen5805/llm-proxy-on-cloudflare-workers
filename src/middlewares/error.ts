import { Middleware } from "../middleware";
import { AppError } from "../utils/error";

export const errorMiddleware: Middleware = async (context, next) => {
  try {
    return await next();
  } catch (err) {
    let status = 500;
    let message = "Internal Server Error";

    if (err instanceof AppError) {
      status = err.status;
      message = err.message;
    } else if (err instanceof Error) {
      message = err.message;
      console.error("Unhandled Error:", err);
    } else {
      console.error("Unknown Error Object:", err);
    }

    return new Response(
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
    );
  }
};
