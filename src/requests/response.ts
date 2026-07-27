export const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

export const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
} as const;

export function withoutBodyForHead(
  request: Request,
  response: Response,
): Response {
  if (request.method !== "HEAD") return response;
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
