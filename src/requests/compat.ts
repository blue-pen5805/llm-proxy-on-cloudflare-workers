import { CloudflareAIGateway } from "../ai_gateway";
import { stripProxyAuthorizationHeaders } from "../utils/authorization";
import { fetch2 } from "../utils/helpers";

export async function compat(
  request: Request,
  pathname: string,
  aiGateway: CloudflareAIGateway,
) {
  const headers = stripProxyAuthorizationHeaders(request.headers);

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
