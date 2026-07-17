import { CloudflareAIGateway } from "../ai_gateway";
import { stripProxyAuthorizationHeaders } from "../utils/authorization";
import { fetchWithLogging } from "../utils/helpers";

export async function handleCompatibilityRequest(
  request: Request,
  aiGateway: CloudflareAIGateway,
) {
  const strippedHeaders = stripProxyAuthorizationHeaders(request.headers);

  const sanitizedHeaders = Object.fromEntries(strippedHeaders.entries());

  const [requestInfo, requestInit] =
    aiGateway.buildCompatibilityEndpointRequest({
      headers: sanitizedHeaders,
      body: request.body,
      signal: request.signal,
    });

  return fetchWithLogging(requestInfo, requestInit);
}
