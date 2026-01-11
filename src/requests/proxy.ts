import { CloudflareAIGateway } from "../ai_gateway";
import { MiddlewareContext } from "../middleware";
import { getProvider } from "../providers";
import { Environments } from "../utils/environments";
import { NotFoundError } from "../utils/error";
import { fetch2 } from "../utils/helpers";
import { Secrets } from "../utils/secrets";

export async function proxy(
  context: MiddlewareContext,
  providerName: string,
  pathname: string,
  aiGateway: CloudflareAIGateway | undefined = undefined,
) {
  const { apiKeyIndex: contextApiKeyIndex } = context;
  const { request } = context;
  const env = Environments.all();
  const providerInstance = getProvider(providerName, env);

  if (!providerInstance) {
    throw new NotFoundError();
  }

  const apiKeyIndex =
    contextApiKeyIndex !== undefined
      ? Secrets.resolveApiKeyIndex(
          contextApiKeyIndex,
          providerInstance.getApiKeys().length,
        )
      : await providerInstance.getNextApiKeyIndex();

  // Handle AI Gateway requests
  if (aiGateway && CloudflareAIGateway.isSupportedProvider(providerName)) {
    return fetch2(
      ...aiGateway.buildProviderEndpointRequest({
        provider: providerName,
        method: request.method,
        path: pathname,
        body: request.body,
        headers: {
          ...(await providerInstance.headers(apiKeyIndex)),
          ...request.headers,
        },
      }),
    );
  }

  // Send request to the provider directly
  return providerInstance.fetch(
    pathname,
    {
      method: request.method,
      body: request.body,
      headers: request.headers,
    },
    apiKeyIndex,
  );
}
