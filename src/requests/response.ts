export const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

export const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
} as const;

const REWRITTEN_BODY_HEADERS = [
  "content-encoding",
  "content-length",
  "content-md5",
  "digest",
  "etag",
] as const;

/** Remove representation metadata that no longer describes a rewritten body. */
export function headersForRewrittenBody(source: Headers): Headers {
  const headers = new Headers(source);
  for (const field of REWRITTEN_BODY_HEADERS) {
    headers.delete(field);
  }
  return headers;
}

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
