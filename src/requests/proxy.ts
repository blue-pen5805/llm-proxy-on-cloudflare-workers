import { CloudflareAIGateway } from "../ai_gateway";
import { MiddlewareContext } from "../middleware";
import { getProvider } from "../providers";
import { selectApiKeyIndex } from "../utils/api_key_selection";
import { stripProxyAuthorizationHeaders } from "../utils/authorization";
import { Environments } from "../utils/environments";
import { NotFoundError } from "../utils/error";
import { fetch2 } from "../utils/helpers";

export async function proxy(
  context: MiddlewareContext,
  providerName: string,
  pathname: string,
  aiGateway: CloudflareAIGateway | undefined = undefined,
) {
  const { apiKeyIndex: contextApiKeyIndex } = context;
  const { request } = context;
  const providerInstance = context.providers
    ? context.providers.get(providerName)
    : getProvider(providerName, Environments.all());

  if (!providerInstance) {
    throw new NotFoundError();
  }

  const apiKeyIndex = await selectApiKeyIndex(
    providerInstance,
    contextApiKeyIndex,
    "rotate",
  );
  const sanitizedHeaders = stripProxyAuthorizationHeaders(request.headers);

  // Handle AI Gateway requests
  if (aiGateway && CloudflareAIGateway.isSupportedProvider(providerName)) {
    const providerHeaders = new Headers(
      await providerInstance.headers(apiKeyIndex),
    );
    providerHeaders.forEach((value, key) => sanitizedHeaders.set(key, value));
    const [requestInfo, requestInit] = aiGateway.buildProviderEndpointRequest({
      provider: providerName,
      method: request.method,
      path: pathname,
      body: request.body,
      headers: Object.fromEntries(sanitizedHeaders.entries()),
    });
    return fetch2(requestInfo, { ...requestInit, signal: request.signal });
  }

  // Send request to the provider directly
  return providerInstance.fetch(
    pathname,
    {
      method: request.method,
      body: request.body,
      headers: Object.fromEntries(sanitizedHeaders.entries()),
      signal: request.signal,
    },
    apiKeyIndex,
  );
}
