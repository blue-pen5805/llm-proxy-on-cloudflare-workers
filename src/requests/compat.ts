import { CloudflareAIGateway } from "../ai_gateway";
import { fetch2 } from "../utils/helpers";

export async function compat(
  request: Request,
  pathname: string,
  aiGateway: CloudflareAIGateway,
) {
  const headers = new Headers(request.headers);
  headers.delete("Authorization");

  const sanitizedHeaders = Object.fromEntries(headers.entries());

  const [requestInfo, requestInit] = aiGateway.buildCompatRequest({
    method: request.method,
    path: pathname,
    headers: sanitizedHeaders,
    body: request.body,
    signal: request.signal,
  });

  return fetch2(requestInfo, requestInit);
}
