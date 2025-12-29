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
    } as MiddlewareContext;
  });

  it("should catch AppError and return appropriate response", async () => {
    const appError = new AppError("Bad Request", 400);
    const next = vi.fn().mockRejectedValue(appError);

    const response = await errorMiddleware(context, next);

    expect(response.status).toBe(400);
    const body = (await response.json()) as any;
    expect(body.error.message).toBe("Bad Request");
    expect(body.error.status).toBe(400);
  });

  it("should catch generic Error and return 500", async () => {
    const genericError = new Error("Something went wrong");
    const next = vi.fn().mockRejectedValue(genericError);

    // Silence console.error for tests
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await errorMiddleware(context, next);

    expect(response.status).toBe(500);
    const body = (await response.json()) as any;
    expect(body.error.message).toBe("Something went wrong");
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("should return successful response if no error occurs", async () => {
    const nextResponse = new Response("success");
    const next = vi.fn().mockResolvedValue(nextResponse);

    const response = await errorMiddleware(context, next);

    expect(response).toBe(nextResponse);
    expect(await response.text()).toBe("success");
  });
});
