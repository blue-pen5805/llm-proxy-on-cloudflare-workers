import { CloudflareAIGateway } from "../ai_gateway";
import { Providers } from "../providers";
import { fetch2 } from "../utils/helpers";
import { Secrets } from "../utils/secrets";

export async function proxy(
  request: Request,
  providerName: string,
  pathname: string,
  aiGateway: CloudflareAIGateway | undefined = undefined,
) {
  const provider = Providers[providerName];
  const providerClass = new provider();

  const apiKeyName = providerClass.apiKeyName as keyof Env;
  const apiKeyIndex = await Secrets.getNext(apiKeyName);

  // Handle AI Gateway requests
  if (aiGateway && CloudflareAIGateway.isSupportedProvider(providerName)) {
    return fetch2(
      ...aiGateway.buildProviderEndpointRequest({
        provider: providerName,
        method: request.method,
        path: pathname,
        body: request.body,
        headers: {
          ...(await providerClass.headers(apiKeyIndex)),
          ...request.headers,
        },
      }),
    );
  }

  // Send request to the provider directly
  return providerClass.fetch(
    pathname,
    {
      method: request.method,
      body: request.body,
      headers: request.headers,
    },
    apiKeyIndex,
  );
}
