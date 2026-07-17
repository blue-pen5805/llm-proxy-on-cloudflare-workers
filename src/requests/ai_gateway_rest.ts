import { CloudflareAIGateway } from "../ai_gateway";
import type { CloudflareAIGatewayRestApiPath } from "../ai_gateway/const";
import { stripProxyAuthorizationHeaders } from "../utils/authorization";
import { fetch2 } from "../utils/helpers";

export async function aiGatewayRest(
  request: Request,
  path: CloudflareAIGatewayRestApiPath,
  aiGateway: CloudflareAIGateway,
): Promise<Response> {
  const headers = stripProxyAuthorizationHeaders(request.headers);
  const [requestInfo, requestInit] = aiGateway.buildRestApiRequest({
    path,
    headers,
    body: request.body,
    signal: request.signal,
  });

  return await fetch2(requestInfo, requestInit);
}
