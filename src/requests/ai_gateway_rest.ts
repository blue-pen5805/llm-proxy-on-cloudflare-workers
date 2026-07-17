import { CloudflareAIGateway } from "../ai_gateway";
import type { CloudflareAIGatewayRestApiPath } from "../ai_gateway/const";
import { stripProxyAuthorizationHeaders } from "../utils/authorization";
import { fetchWithLogging } from "../utils/helpers";

export async function handleAiGatewayRestRequest(
  request: Request,
  path: CloudflareAIGatewayRestApiPath,
  aiGateway: CloudflareAIGateway,
): Promise<Response> {
  const sanitizedHeaders = stripProxyAuthorizationHeaders(request.headers);
  const [requestInfo, requestInit] = aiGateway.buildRestApiRequest({
    path,
    headers: sanitizedHeaders,
    body: request.body,
    signal: request.signal,
  });

  return await fetchWithLogging(requestInfo, requestInit);
}
