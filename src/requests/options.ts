import { Config } from "../utils/config";

const CORS_HEADERS = {
  "Access-Control-Allow-Methods": "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Max-Age": "86400",
};
const CORS_EXPOSE_HEADERS = "X-Proxy-Models-Cache,X-Proxy-Models-Truncated";

function allowedCorsOrigin(request: Request): string | undefined {
  const requestOrigin = request.headers.get("Origin");
  /* istanbul ignore next -- public callers invoke this helper only after confirming that Origin is present */
  if (requestOrigin === null) return undefined;
  const allowedOrigins = Config.allowedOrigins();
  return allowedOrigins === undefined
    ? "*"
    : allowedOrigins.includes(requestOrigin)
      ? requestOrigin
      : undefined;
}

export function addCorsHeaders(request: Request, response: Response): Response {
  if (request.headers.get("Origin") === null) return response;

  const headers = new Headers(response.headers);
  // Error handling may reach this function after ALLOWED_ORIGINS itself failed
  // validation. Preserve the safe error response without recursively throwing.
  try {
    const allowedOrigin = allowedCorsOrigin(request);
    if (allowedOrigin) {
      headers.set("Access-Control-Allow-Origin", allowedOrigin);
      headers.set("Access-Control-Expose-Headers", CORS_EXPOSE_HEADERS);
    }
  } catch {
    headers.delete("Access-Control-Allow-Origin");
  }
  // The presence of the CORS headers depends on the request's Origin, so any
  // cache in front of the Worker must key on it.
  headers.append("Vary", "Origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// https://developers.cloudflare.com/workers/examples/cors-header-proxy/
export async function handleOptions(request: Request): Promise<Response> {
  if (
    request.headers.get("Origin") !== null &&
    request.headers.get("Access-Control-Request-Method") !== null
  ) {
    const headers = new Headers(CORS_HEADERS);
    headers.append("Vary", "Origin");
    const allowedOrigin = allowedCorsOrigin(request);
    if (allowedOrigin) {
      headers.set("Access-Control-Allow-Origin", allowedOrigin);
      const requestedHeaders = request.headers.get(
        "Access-Control-Request-Headers",
      );
      if (requestedHeaders !== null) {
        headers.set("Access-Control-Allow-Headers", requestedHeaders);
        headers.append("Vary", "Access-Control-Request-Headers");
      }
    }
    return new Response(null, {
      headers,
    });
  } else {
    // Handle standard OPTIONS request.
    return new Response(null, {
      headers: {
        Allow: "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
      },
    });
  }
}
