export type OpenAIErrorType =
  | "invalid_request_error"
  | "authentication_error"
  | "not_found_error"
  | "server_error";

export function openAIErrorResponse(
  message: string,
  status: number,
  {
    type = status === 401
      ? "authentication_error"
      : status === 404
        ? "not_found_error"
        : status >= 500
          ? "server_error"
          : "invalid_request_error",
    code = null,
    param = null,
  }: {
    type?: OpenAIErrorType;
    code?: string | null;
    param?: string | null;
  } = {},
): Response {
  return Response.json(
    {
      error: {
        message,
        type,
        param,
        code,
      },
    },
    { status },
  );
}

export function anthropicErrorResponse(
  message: string,
  status: number,
  type = status >= 500 ? "api_error" : "invalid_request_error",
): Response {
  return Response.json(
    {
      type: "error",
      error: { type, message },
    },
    { status },
  );
}
