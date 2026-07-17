import { CloudflareAIGateway } from "../ai_gateway";
import { MiddlewareContext } from "../middleware";
import {
  apiKeySelectionPolicy,
  recordApiKeySelection,
  selectApiKeyIndex,
} from "../utils/api_key_selection";
import { stripProxyAuthorizationHeaders } from "../utils/authorization";
import { NotFoundError } from "../utils/error";
import { fetch2 } from "../utils/helpers";
import { RequestLogger } from "../utils/logger";
import {
  providerConfigurationErrorResponse,
  resolveProvider,
} from "./provider_request";

export async function proxy(
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

  const providerError = providerConfigurationErrorResponse(
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
    selectionPolicy: apiKeySelectionPolicy(contextApiKeyIndex, "rotate"),
    viaAiGateway: aiGatewayProvider !== undefined,
  });
  const sanitizedHeaders = stripProxyAuthorizationHeaders(request.headers);

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
      fetch2(requestInfo, { ...requestInit, signal: request.signal }),
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
