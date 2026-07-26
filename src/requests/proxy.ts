import { CloudflareAIGateway } from "../ai_gateway";
import {
  gatewayProviderPath,
  resolveGatewayProvider,
} from "../ai_gateway/custom_provider";
import { MiddlewareContext } from "../middleware";
import { parseProviderSelector } from "../providers/profile";
import {
  determineApiKeySelectionPolicy,
  recordApiKeyOutcome,
  recordApiKeySelection,
  selectApiKeyIndex,
} from "../utils/api_key_selection";
import { stripProxyAuthorizationHeaders } from "../utils/authorization";
import { NotFoundError } from "../utils/error";
import { assertSafeProxyPath, fetchWithLogging } from "../utils/helpers";
import { RequestLogger } from "../utils/logger";
import {
  createProviderConfigurationErrorResponse,
  resolveProvider,
} from "./provider_request";

export async function handleProviderProxyRequest(
  context: MiddlewareContext,
  providerSelector: string,
  pathname: string,
  aiGateway: CloudflareAIGateway | undefined = undefined,
) {
  const { apiKeyIndex: contextApiKeyIndex } = context;
  const { request } = context;
  const parsedSelector = parseProviderSelector(providerSelector);
  /* istanbul ignore next -- registry matches only validated selectors */
  if (!parsedSelector) throw new NotFoundError();
  const { providerName, profile } = parsedSelector;
  RequestLogger.start({
    endpoint: "provider_proxy",
    provider: providerName,
    credential_profile: profile === "default" ? undefined : profile,
  });
  // Reject traversal/scheme smuggling in the client-controlled path before it is
  // concatenated into the provider or Gateway upstream URL.
  assertSafeProxyPath(pathname);
  const providerInstance = resolveProvider(context, providerSelector);

  if (!providerInstance) {
    throw new NotFoundError();
  }

  const providerError = createProviderConfigurationErrorResponse(
    providerSelector,
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
    providerSelector,
  );
  const keyCount = providerInstance.getApiKeys().length;
  const aiGatewayProvider = resolveGatewayProvider(
    providerName,
    aiGateway,
    !providerInstance.requiresCustomAiGatewayProvider &&
      CloudflareAIGateway.isSupportedProvider(providerName),
  );
  const keyLogFields = recordApiKeySelection({
    provider: providerName,
    credentialProfile: profile,
    operation: "proxy",
    keyIndex: apiKeyIndex,
    keyCount,
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
      await providerInstance.buildHeadersForPath(
        pathname,
        sanitizedHeaders,
        apiKeyIndex,
      ),
    );
    const [requestInfo, requestInit] = aiGateway.buildProviderEndpointRequest({
      provider: aiGatewayProvider,
      method: request.method,
      path: gatewayProviderPath(
        providerName,
        providerInstance,
        pathname,
        aiGatewayProvider,
      ),
      body: request.body,
      headers: providerHeaders,
    });
    const response = await RequestLogger.withFields(keyLogFields, () =>
      fetchWithLogging(requestInfo, { ...requestInit, signal: request.signal }),
    );
    recordApiKeyOutcome(
      providerSelector,
      apiKeyIndex,
      keyCount,
      response.status,
    );
    return response;
  }

  // Send request to the provider directly
  const response = await RequestLogger.withFields(keyLogFields, () =>
    providerInstance.fetch(
      pathname,
      {
        method: request.method,
        body: request.body,
        headers: sanitizedHeaders,
        signal: request.signal,
      },
      apiKeyIndex,
    ),
  );
  recordApiKeyOutcome(providerSelector, apiKeyIndex, keyCount, response.status);
  return response;
}
