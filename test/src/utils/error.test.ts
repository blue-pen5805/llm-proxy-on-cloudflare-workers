import { describe, it, expect } from "vitest";
import {
  AppError,
  BadRequestError,
  UnauthorizedError,
  NotFoundError,
  ServiceUnavailableError,
} from "~/src/utils/error";

describe("Error Classes", () => {
  it("AppError should have correct properties", () => {
    const error = new AppError("test message", 418);
    expect(error.message).toBe("test message");
    expect(error.status).toBe(418);
    expect(error.name).toBe("AppError");
    expect(error instanceof Error).toBe(true);
  });

  it.each([
    [BadRequestError, 400, "Bad Request"],
    [UnauthorizedError, 401, "Unauthorized"],
    [NotFoundError, 404, "Not Found"],
    [ServiceUnavailableError, 503, "Service Unavailable"],
  ])("%p should default to status %i", (ErrorClass, status, message) => {
    const error = new ErrorClass();
    expect(error.status).toBe(status);
    expect(error.message).toBe(message);
  });
});
