const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
  "Access-Control-Max-Age": "86400",
};

export function addCorsHeaders(request: Request, response: Response): Response {
  if (request.headers.get("Origin") === null) return response;

  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
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
    const requestedHeaders = request.headers.get(
      "Access-Control-Request-Headers",
    );
    if (requestedHeaders !== null) {
      headers.set("Access-Control-Allow-Headers", requestedHeaders);
      headers.append("Vary", "Access-Control-Request-Headers");
    }
    return new Response(null, {
      headers,
    });
  } else {
    // Handle standard OPTIONS request.
    return new Response(null, {
      headers: {
        Allow: "GET, HEAD, POST, OPTIONS",
      },
    });
  }
}
