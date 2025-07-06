import { CloudflareAIGateway } from "../ai_gateway";
import { Providers } from "../providers";
import { fetch2 } from "../utils/helpers";

export async function proxy(
  request: Request,
  providerName: string,
  pathname: string,
  aiGateway: CloudflareAIGateway | undefined = undefined,
) {
  const provider = Providers[providerName];
  const providerClass = new provider();

  // Handle AI Gateway requests
  if (aiGateway && CloudflareAIGateway.isSupportedProvider(providerName)) {
    return fetch2(
      ...aiGateway.buildProviderEndpointRequest({
        provider: providerName,
        method: request.method,
        path: pathname,
        body: request.body,
        headers: {
          ...providerClass.endpoint.headers(),
          ...request.headers,
        },
      }),
    );
  }

  // Send request to the provider directly
  return providerClass.fetch(pathname, {
    method: request.method,
    body: request.body,
    headers: request.headers,
  });
}
