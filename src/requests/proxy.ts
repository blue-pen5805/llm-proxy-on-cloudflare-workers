import { CloudflareAIGateway } from "../ai_gateway";
import { MiddlewareContext } from "../middleware";
import {
  determineApiKeySelectionPolicy,
  recordApiKeySelection,
  selectApiKeyIndex,
} from "../utils/api_key_selection";
import { stripProxyAuthorizationHeaders } from "../utils/authorization";
import { NotFoundError } from "../utils/error";
import { fetchWithLogging } from "../utils/helpers";
import { RequestLogger } from "../utils/logger";
import {
  createProviderConfigurationErrorResponse,
  resolveProvider,
} from "./provider_request";

export async function handleProviderProxyRequest(
  context: MiddlewareContext,
  providerName: string,
  pathname: string,
  aiGateway: CloudflareAIGateway | undefined = undefined,
) {
  const { apiKeyIndex: contextApiKeyIndex } = context;
  const { request } = context;
  const providerInstance = resolveProvider(context, providerName);

  if (!providerInstance) {
    throw new NotFoundError();
  }

  const providerError = createProviderConfigurationErrorResponse(
    providerName,
    providerInstance,
    aiGateway,
  );
  if (providerError) {
    return providerError;
  }

  const apiKeyIndex = await selectApiKeyIndex(
    providerInstance,
    contextApiKeyIndex,
    "rotate",
  );
  const aiGatewayProvider =
    aiGateway && CloudflareAIGateway.isSupportedProvider(providerName)
      ? providerName
      : undefined;
  const keyLogFields = recordApiKeySelection({
    provider: providerName,
    operation: "proxy",
    keyIndex: apiKeyIndex,
    keyCount: providerInstance.getApiKeys().length,
    selectionPolicy: determineApiKeySelectionPolicy(
      contextApiKeyIndex,
      "rotate",
    ),
    viaAiGateway: aiGatewayProvider !== undefined,
  });
  const sanitizedHeaders = stripProxyAuthorizationHeaders(request.headers, {
    preserveAiGatewayHeaders: aiGatewayProvider !== undefined,
  });

  // Handle AI Gateway requests
  if (aiGateway && aiGatewayProvider) {
    const providerHeaders = new Headers(
      await providerInstance.headers(apiKeyIndex),
    );
    providerHeaders.forEach((value, key) => sanitizedHeaders.set(key, value));
    const [requestInfo, requestInit] = aiGateway.buildProviderEndpointRequest({
      provider: aiGatewayProvider,
      method: request.method,
      path: providerInstance.aiGatewayPath?.(pathname) ?? pathname,
      body: request.body,
      headers: Object.fromEntries(sanitizedHeaders.entries()),
    });
    return RequestLogger.withFields(keyLogFields, () =>
      fetchWithLogging(requestInfo, { ...requestInit, signal: request.signal }),
    );
  }

  // Send request to the provider directly
  return RequestLogger.withFields(keyLogFields, () =>
    providerInstance.fetch(
      pathname,
      {
        method: request.method,
        body: request.body,
        headers: Object.fromEntries(sanitizedHeaders.entries()),
        signal: request.signal,
      },
      apiKeyIndex,
    ),
  );
}
