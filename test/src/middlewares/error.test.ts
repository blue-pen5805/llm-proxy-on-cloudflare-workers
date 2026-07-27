import { describe, it, expect, vi, beforeEach } from "vitest";
import { MiddlewareContext } from "~/src/middleware";
import { errorMiddleware } from "~/src/middlewares/error";
import { AppError } from "~/src/utils/error";

describe("errorMiddleware", () => {
  let context: MiddlewareContext;

  beforeEach(() => {
    vi.resetAllMocks();
    context = {
      request: new Request("http://localhost/"),
      pathname: "/",
    } as MiddlewareContext;
  });

  it("should catch AppError and return appropriate response", async () => {
    const appError = new AppError("Bad Request", 400);
    const next = vi.fn().mockRejectedValue(appError);

    const response = await errorMiddleware(context, next);

    expect(response.status).toBe(400);
    const body = (await response.json()) as any;
    expect(body.error.message).toBe("Bad Request");
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.code).toBeNull();
  });

  it("uses the default AppError status", async () => {
    const response = await errorMiddleware(
      context,
      vi.fn().mockRejectedValue(new AppError("Default status")),
    );
    expect(response.status).toBe(500);
  });

  it("should catch generic Error and return 500", async () => {
    const genericError = new Error("Something went wrong");
    const next = vi.fn().mockRejectedValue(genericError);

    // Silence console.error for tests
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await errorMiddleware(context, next);

    expect(response.status).toBe(500);
    const body = (await response.json()) as any;
    expect(body.error.message).toBe("Internal Server Error");
    expect(consoleSpy).toHaveBeenCalledWith({
      event: "request.unhandled_error",
      request_id: null,
      error_name: "Error",
      error_message: "Something went wrong",
      message:
        "Request failed with an unhandled error: error_name=Error, error_message=Something went wrong",
    });

    consoleSpy.mockRestore();
  });

  it("should return successful response if no error occurs", async () => {
    const nextResponse = new Response("success");
    const next = vi.fn().mockResolvedValue(nextResponse);

    const response = await errorMiddleware(context, next);

    expect(response).toBe(nextResponse);
    expect(await response.text()).toBe("success");
  });

  it("adds CORS headers to an error raised for a cross-origin caller", async () => {
    context.request = new Request("https://proxy.example/", {
      headers: { Origin: "https://app.example" },
    });

    const response = await errorMiddleware(
      context,
      vi.fn().mockRejectedValue(new AppError("Bad Request", 400)),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Vary")).toBe("Origin");
    expect(response.headers.get("Content-Type")).toBe("application/json");
  });

  it("should hide unknown thrown values", async () => {
    const next = vi.fn().mockRejectedValue({ reason: "not an Error" });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await errorMiddleware(context, next);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        message: "Internal Server Error",
        type: "server_error",
        param: null,
        code: null,
      },
    });
    expect(consoleSpy).toHaveBeenCalledWith({
      event: "request.unhandled_error",
      request_id: null,
      error_name: "NonError",
      error_message: "Non-Error value thrown",
      message:
        "Request failed with an unhandled error: error_name=NonError, error_message=Non-Error value thrown",
    });
  });

  it("uses the Anthropic envelope on Messages routes", async () => {
    context.pathname = "/v1/messages";
    const response = await errorMiddleware(
      context,
      vi.fn().mockRejectedValue(new AppError("Messages failed", 400)),
    );
    await expect(response.json()).resolves.toEqual({
      type: "error",
      error: {
        type: "invalid_request_error",
        message: "Messages failed",
      },
    });
  });

  it("uses Anthropic api_error and the request URL fallback", async () => {
    context.pathname = "";
    context.request = new Request("https://proxy.example/v1/messages");
    const response = await errorMiddleware(
      context,
      vi.fn().mockRejectedValue(new AppError("Messages failed", 503)),
    );
    await expect(response.json()).resolves.toMatchObject({
      type: "error",
      error: { type: "api_error", message: "Messages failed" },
    });
  });
});
