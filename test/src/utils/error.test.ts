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

  it("BadRequestError should have status 400", () => {
    const error = new BadRequestError();
    expect(error.status).toBe(400);
    expect(error.message).toBe("Bad Request");
  });

  it("UnauthorizedError should have status 401", () => {
    const error = new UnauthorizedError();
    expect(error.status).toBe(401);
    expect(error.message).toBe("Unauthorized");
  });

  it("NotFoundError should have status 404", () => {
    const error = new NotFoundError();
    expect(error.status).toBe(404);
    expect(error.message).toBe("Not Found");
  });

  it("ServiceUnavailableError should use its default message", () => {
    const error = new ServiceUnavailableError();
    expect(error.status).toBe(503);
    expect(error.message).toBe("Service Unavailable");
  });
});
