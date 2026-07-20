import { CloudflareAIGateway } from "../ai_gateway";
import {
  gatewayProviderPath,
  resolveGatewayProvider,
} from "../ai_gateway/custom_provider";
import { MiddlewareContext } from "../middleware";
import { mergeHeaders } from "../providers/provider";
import {
  determineApiKeySelectionPolicy,
  recordApiKeySelection,
  selectApiKeyIndex,
} from "../utils/api_key_selection";
import { stripProxyAuthorizationHeaders } from "../utils/authorization";
import { Config, VIRTUAL_MODEL_PROVIDER_NAME } from "../utils/config";
import {
  parseJsonOrReturnText,
  readRequestText,
  shuffleArray,
} from "../utils/helpers";
import { RequestLogger } from "../utils/logger";
import { fetchCompatibilityFallback } from "./compatibility_fallback";
import {
  createProviderConfigurationErrorResponse,
  resolveProvider,
} from "./provider_request";
import {
  ChatCompletionAttemptResult,
  fetchWithCandidateTimeout,
  isRetryableCandidateStatus,
  runVirtualModelChain,
} from "./virtual_model";

function invalidRequestResponse(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function handleChatCompletionsRequest(
  context: MiddlewareContext,
  aiGateway: CloudflareAIGateway | undefined = undefined,
) {
  const { request } = context;
  // Validate Request Data Structure
  const parsedRequestBody = parseJsonOrReturnText(
    await readRequestText(request),
  );
  if (
    typeof parsedRequestBody !== "object" ||
    parsedRequestBody === null ||
    typeof (parsedRequestBody as Record<string, unknown>).model !== "string"
  ) {
    return invalidRequestResponse("Invalid request.");
  }

  const chatRequestBody = parsedRequestBody as Record<string, unknown> & {
    model: string;
  };
  const requestedModel =
    chatRequestBody.model === "default"
      ? Config.defaultModel()
      : chatRequestBody.model;
  if (!requestedModel) {
    return invalidRequestResponse("Invalid request.");
  }

  // A model of "virtual/<name>" never names a real provider: it looks up an
  // operator-configured ordered candidate list and tries each in turn.
  if (requestedModel.startsWith(`${VIRTUAL_MODEL_PROVIDER_NAME}/`)) {
    const candidates = Config.virtualModels()?.[requestedModel];
    if (!candidates) {
      return invalidRequestResponse("Invalid provider.");
    }
    return await runVirtualModelChain(
      requestedModel,
      candidates,
      (candidateModel, timeout) =>
        attemptChatCompletion(
          context,
          aiGateway,
          chatRequestBody,
          candidateModel,
          timeout,
        ),
    );
  }

  const { response } = await attemptChatCompletion(
    context,
    aiGateway,
    chatRequestBody,
    requestedModel,
  );
  return response;
}

async function attemptChatCompletion(
  context: MiddlewareContext,
  aiGateway: CloudflareAIGateway | undefined,
  chatRequestBody: Record<string, unknown> & { model: string },
  requestedModel: string,
  timeout?: number,
): Promise<ChatCompletionAttemptResult> {
  const { request, apiKeyIndex: contextApiKeyIndex } = context;
  const fetchWithTimeout = (
    fetchAttempt: (signal: AbortSignal) => Promise<Response>,
  ) => fetchWithCandidateTimeout(request.signal, timeout, fetchAttempt);

  // Split model into provider and model name
  const [providerName, ...modelParts] = requestedModel.split("/");
  const model = modelParts.join("/");

  // Validate provider name
  const providerInstance = resolveProvider(context, providerName);
  if (!providerInstance) {
    return {
      response: invalidRequestResponse("Invalid provider."),
      retryable: true,
    };
  }

  const providerError = createProviderConfigurationErrorResponse(
    providerName,
    providerInstance,
    aiGateway,
  );
  if (providerError) {
    return { response: providerError, retryable: true };
  }
  const transformResponse = async (
    responsePromise: Promise<Response>,
  ): Promise<Response> =>
    providerInstance.transformChatCompletionsResponse(await responsePromise);

  // Get API key apiKeyIndex
  const apiKeyIndex = await selectApiKeyIndex(
    providerInstance,
    contextApiKeyIndex,
    "rotate",
  );
  const aiGatewayProvider =
    aiGateway &&
    !providerInstance.requiresCustomAiGatewayProvider &&
    CloudflareAIGateway.isSupportedProvider(providerName, true)
      ? providerName
      : undefined;
  // Retain request-level Gateway controls only when this provider will use
  // AI Gateway. Direct provider requests must not receive Cloudflare metadata.
  const sanitizedHeaders = stripProxyAuthorizationHeaders(request.headers, {
    preserveAiGatewayHeaders: Boolean(
      aiGateway &&
      (aiGateway.alwaysUse ||
        (!providerInstance.requiresCustomAiGatewayProvider &&
          CloudflareAIGateway.isSupportedProvider(providerName))),
    ),
  });
  const configuredApiKeys = providerInstance.getApiKeys();
  const gatewayApiKeys =
    providerInstance.getAiGatewayApiKeys?.() ?? configuredApiKeys;
  const selectionPolicy = determineApiKeySelectionPolicy(
    contextApiKeyIndex,
    "rotate",
  );
  const recordSelection = (selectedIndex: number) =>
    recordApiKeySelection({
      provider: providerName,
      operation: "chat_completions",
      keyIndex: selectedIndex,
      keyCount: configuredApiKeys.length,
      selectionPolicy,
      viaAiGateway:
        aiGatewayProvider !== undefined ||
        Boolean(
          aiGateway &&
          (aiGateway.alwaysUse || providerInstance.supportsAiGatewayNativeChat),
        ),
    });

  // Generate chat completions request
  const supportedRequestBody = providerInstance.filterSupportedChatParameters({
    ...chatRequestBody,
    model,
  });

  // If AI Gateway is enabled and the provider supports it, use AI Gateway
  if (aiGateway && aiGatewayProvider) {
    const remainingApiKeyIndexes = shuffleArray(
      configuredApiKeys
        .map((_apiKey, candidateIndex) => candidateIndex)
        .filter((candidateIndex) => candidateIndex !== apiKeyIndex),
    );
    const gatewayApiKeyIndexes =
      configuredApiKeys.length === 0
        ? []
        : contextApiKeyIndex === undefined
          ? [apiKeyIndex, ...remainingApiKeyIndexes]
          : [apiKeyIndex];
    // The Compatibility Endpoint serializes its own request body from the
    // parsed data, so the provider request builder (whose serialized body
    // would be discarded) is skipped; only its header merge is reproduced.
    // Providers reaching this path use the default builder, which layers
    // provider-computed headers over the sanitized client headers.
    const gatewayRequests = await aiGateway.buildChatCompletionsRequests({
      provider: aiGatewayProvider,
      body: "",
      parsedBody: supportedRequestBody as {
        model: string;
        [key: string]: unknown;
      },
      headers: mergeHeaders(
        sanitizedHeaders,
        await providerInstance.headers(apiKeyIndex),
      ),
      apiKeys: gatewayApiKeyIndexes.map(
        (candidateIndex) =>
          gatewayApiKeys[candidateIndex] ?? configuredApiKeys[candidateIndex],
      ),
    });
    const response = await transformResponse(
      fetchWithTimeout((signal) =>
        fetchCompatibilityFallback(
          gatewayRequests,
          signal,
          /* istanbul ignore next -- Gateway requests and credential indexes are built one-to-one */
          (attemptIndex) =>
            recordSelection(gatewayApiKeyIndexes[attemptIndex] ?? 0),
        ),
      ),
    );
    return { response, retryable: isRetryableCandidateStatus(response.status) };
  }

  const [requestInfo, requestInit] =
    await providerInstance.buildChatCompletionsRequest({
      body: "",
      preparedData: supportedRequestBody,
      headers: sanitizedHeaders,
      apiKeyIndex,
    });

  const keyLogFields = recordSelection(apiKeyIndex);

  // Some Gateway providers (notably Azure OpenAI) require account-specific
  // path segments and are not represented by the Compatibility Endpoint.
  if (
    aiGateway &&
    !providerInstance.requiresCustomAiGatewayProvider &&
    CloudflareAIGateway.isSupportedProvider(providerName)
  ) {
    const providerRequest =
      await providerInstance.buildAiGatewayChatCompletionsRequest({
        data: supportedRequestBody as Record<string, unknown> & {
          model: string;
        },
        headers: sanitizedHeaders,
        apiKeyIndex,
      });
    if (providerRequest) {
      const [path, init] = providerRequest;
      const [url, gatewayInit] = aiGateway.buildProviderEndpointRequest({
        provider: providerName,
        method: init.method,
        path,
        body: init.body,
        headers: init.headers ?? {},
      });
      const response = await transformResponse(
        RequestLogger.withFields(
          { ...keyLogFields, via_ai_gateway: true },
          () =>
            fetchWithTimeout((signal) =>
              fetchCompatibilityFallback([[url, gatewayInit]], signal),
            ),
        ),
      );
      return {
        response,
        retryable: isRetryableCandidateStatus(response.status),
      };
    }
  }

  // In strict Gateway mode, a provider-specific endpoint is the final route
  // for native providers without Compatibility support and for Custom
  // Providers registered by the deployment helper. Direct fallback is never
  // allowed in this mode.
  const strictGatewayProvider = aiGateway?.alwaysUse
    ? resolveGatewayProvider(
        providerName,
        aiGateway,
        !providerInstance.requiresCustomAiGatewayProvider &&
          CloudflareAIGateway.isSupportedProvider(providerName),
      )
    : undefined;
  if (aiGateway && strictGatewayProvider) {
    const [url, gatewayInit] = aiGateway.buildProviderEndpointRequest({
      provider: strictGatewayProvider,
      method: requestInit.method,
      path: gatewayProviderPath(
        providerName,
        providerInstance,
        providerInstance.chatCompletionPath,
        strictGatewayProvider,
      ),
      body: requestInit.body,
      // Provider request builders always normalize headers before returning.
      headers: requestInit.headers!,
    });
    const response = await transformResponse(
      RequestLogger.withFields({ ...keyLogFields, via_ai_gateway: true }, () =>
        fetchWithTimeout((signal) =>
          fetchCompatibilityFallback([[url, gatewayInit]], signal),
        ),
      ),
    );
    return { response, retryable: isRetryableCandidateStatus(response.status) };
  }

  // Request to the provider endpoint
  const response = await transformResponse(
    RequestLogger.withFields(keyLogFields, () =>
      fetchWithTimeout((signal) =>
        providerInstance.fetch(
          requestInfo,
          {
            ...requestInit,
            signal,
          },
          apiKeyIndex,
        ),
      ),
    ),
  );
  return { response, retryable: isRetryableCandidateStatus(response.status) };
}
