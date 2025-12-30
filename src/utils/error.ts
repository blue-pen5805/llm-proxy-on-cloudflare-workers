export class AppError extends Error {
  constructor(
    public message: string,
    public status: number = 500,
  ) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string = "Bad Request") {
    super(message, 400);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = "Unauthorized") {
    super(message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = "Forbidden") {
    super(message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = "Not Found") {
    super(message, 404);
  }
}

export class InternalServerError extends AppError {
  constructor(message: string = "Internal Server Error") {
    super(message, 500);
  }
}
