import { CloudflareAIGateway } from "../ai_gateway";
import {
  gatewayProviderPath,
  resolveGatewayProvider,
} from "../ai_gateway/custom_provider";
import { addProxyAiGatewayMetadata } from "../ai_gateway/metadata";
import { MiddlewareContext } from "../middleware";
import { parseProviderSelector } from "../providers/profile";
import { mergeHeaders } from "../providers/provider";
import {
  determineApiKeySelectionPolicy,
  getEligibleApiKeyIndexes,
  recordApiKeyOutcome,
  recordApiKeySelection,
  selectApiKeyIndex,
} from "../utils/api_key_selection";
import { stripProxyAuthorizationHeaders } from "../utils/authorization";
import { Config, type VirtualModels } from "../utils/config";
import { ConfigurationError } from "../utils/error";
import {
  parseJsonOrReturnText,
  readRequestText,
  shuffleArray,
} from "../utils/helpers";
import { redactLogText, RequestLogger } from "../utils/logger";
import {
  ChatResponseRouteMetadata,
  enrichChatResponseWithMetadata,
} from "./chat_response_metadata";
import { fetchCompatibilityFallback } from "./compatibility_fallback";
import { openAIErrorResponse } from "./error_response";
import {
  createProviderConfigurationErrorResponse,
  resolveProvider,
} from "./provider_request";
import {
  ChatCompletionAttemptResult,
  fetchWithCandidateTimeout,
  isRetryableCandidateStatus,
  runVirtualModelChainAttempt,
} from "./virtual_model";

function invalidRequestResponse(message: string, status = 400): Response {
  return openAIErrorResponse(message, status);
}

export interface PreparedChatCompletionsRequest {
  body: Record<string, unknown> & { model: string };
  endpoint?: "messages" | "responses";
  headers: HeadersInit;
  responseMetadataEnabled: boolean;
}

export async function handleChatCompletionsRequest(
  context: MiddlewareContext,
  aiGateway: CloudflareAIGateway | undefined = undefined,
  preparedRequest?: PreparedChatCompletionsRequest,
) {
  const { request } = context;
  const endpoint = preparedRequest?.endpoint ?? "chat_completions";
  const responseMetadataEnabled =
    preparedRequest?.responseMetadataEnabled ??
    Config.chatResponseMetadataEnabled();
  const startedAt = responseMetadataEnabled ? new Date().toISOString() : "";
  const startedAtPerformance = responseMetadataEnabled ? performance.now() : 0;
  // Validate Request Data Structure
  const parsedRequestBody =
    preparedRequest?.body ??
    parseJsonOrReturnText(await readRequestText(request));
  if (
    typeof parsedRequestBody !== "object" ||
    parsedRequestBody === null ||
    typeof (parsedRequestBody as Record<string, unknown>).model !== "string"
  ) {
    RequestLogger.start({ endpoint });
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
    RequestLogger.start({ endpoint });
    return invalidRequestResponse("Invalid request.");
  }

  // Real providers and Custom OpenAI endpoints take precedence: only when the
  // requested model does not name one do we consult the operator-defined
  // virtual model map, whose keys are then tried as an ordered candidate list.
  // "virtual/<name>" is the recommended convention for these keys (no real
  // provider is named "virtual"), but any configured key resolves here.
  const [providerSelector] = requestedModel.split("/");
  const parsedProviderSelector = parseProviderSelector(providerSelector);
  const providerInstance = resolveProvider(context, providerSelector);
  const virtualModels = providerInstance ? undefined : Config.virtualModels();
  const candidates = virtualModels?.[requestedModel];
  const modelSeparatorIndex = requestedModel.indexOf("/");
  RequestLogger.start({
    endpoint,
    provider: providerInstance
      ? parsedProviderSelector?.providerName
      : undefined,
    credential_profile:
      providerInstance &&
      parsedProviderSelector?.profile !== undefined &&
      parsedProviderSelector.profile !== "default"
        ? parsedProviderSelector.profile
        : undefined,
    model: providerInstance
      ? modelSeparatorIndex === -1
        ? undefined
        : redactLogText(requestedModel.slice(modelSeparatorIndex + 1)) ||
          undefined
      : candidates
        ? redactLogText(requestedModel)
        : undefined,
  });
  if (!providerInstance && virtualModels) {
    if (candidates) {
      const result = await attemptResolvedChatCompletion(
        context,
        aiGateway,
        chatRequestBody,
        requestedModel,
        virtualModels,
        requestedModel,
        endpoint,
        new Set(),
        preparedRequest?.headers ?? request.headers,
      );
      return result.route && responseMetadataEnabled
        ? enrichChatResponseWithMetadata({
            response: result.response,
            route: result.route,
            requestedModel,
            requestId: RequestLogger.requestId(),
            startedAt,
            startedAtPerformance,
          })
        : result.response;
    }
  }

  const result = await attemptChatCompletion(
    context,
    aiGateway,
    chatRequestBody,
    requestedModel,
    preparedRequest?.headers ?? request.headers,
    endpoint,
    undefined,
  );
  return result.route && responseMetadataEnabled
    ? enrichChatResponseWithMetadata({
        response: result.response,
        route: result.route,
        requestedModel,
        requestId: RequestLogger.requestId(),
        startedAt,
        startedAtPerformance,
      })
    : result.response;
}

async function attemptResolvedChatCompletion(
  context: MiddlewareContext,
  aiGateway: CloudflareAIGateway | undefined,
  chatRequestBody: Record<string, unknown> & { model: string },
  requestedModel: string,
  virtualModels: VirtualModels,
  virtualModel: string,
  endpoint: PreparedChatCompletionsRequest["endpoint"] | "chat_completions",
  resolving: ReadonlySet<string>,
  requestHeaders: HeadersInit,
  inheritedTimeout?: number,
): Promise<ChatCompletionAttemptResult> {
  const separatorIndex = requestedModel.indexOf("/");
  const providerSelector =
    separatorIndex === -1
      ? requestedModel
      : requestedModel.slice(0, separatorIndex);
  if (resolveProvider(context, providerSelector)) {
    return attemptChatCompletion(
      context,
      aiGateway,
      chatRequestBody,
      requestedModel,
      requestHeaders,
      endpoint,
      inheritedTimeout,
      virtualModel,
    );
  }

  const candidates = virtualModels[requestedModel];
  if (!candidates) {
    return attemptChatCompletion(
      context,
      aiGateway,
      chatRequestBody,
      requestedModel,
      requestHeaders,
      endpoint,
      inheritedTimeout,
      virtualModel,
    );
  }
  // Config validation rejects cycles before this point. Keep a request-local
  // guard as defense in depth for configuration installed outside the
  // repository deployment helper.
  if (resolving.has(requestedModel)) {
    throw new ConfigurationError("VIRTUAL_MODELS");
  }
  const nextResolving = new Set(resolving).add(requestedModel);
  return runVirtualModelChainAttempt(
    requestedModel,
    candidates,
    (candidateModel, timeout) =>
      attemptResolvedChatCompletion(
        context,
        aiGateway,
        chatRequestBody,
        candidateModel,
        virtualModels,
        virtualModel,
        endpoint,
        nextResolving,
        requestHeaders,
        timeout ?? inheritedTimeout,
      ),
  );
}

async function attemptChatCompletion(
  context: MiddlewareContext,
  aiGateway: CloudflareAIGateway | undefined,
  chatRequestBody: Record<string, unknown> & { model: string },
  requestedModel: string,
  requestHeaders: HeadersInit,
  endpoint: PreparedChatCompletionsRequest["endpoint"] | "chat_completions",
  timeout?: number,
  virtualModel?: string,
): Promise<ChatCompletionAttemptResult> {
  const { request, apiKeyIndex: contextApiKeyIndex } = context;
  const fetchWithTimeout = (
    fetchAttempt: (signal: AbortSignal) => Promise<Response>,
  ) => fetchWithCandidateTimeout(request.signal, timeout, fetchAttempt);

  // Split model into provider and model name
  const separatorIndex = requestedModel.indexOf("/");
  const providerSelector =
    separatorIndex === -1
      ? requestedModel
      : requestedModel.slice(0, separatorIndex);
  const model =
    separatorIndex === -1 ? "" : requestedModel.slice(separatorIndex + 1);
  const loggedModel = redactLogText(model) || undefined;
  const parsedSelector = parseProviderSelector(providerSelector);

  // Validate provider name
  const providerInstance = resolveProvider(context, providerSelector);
  if (!providerInstance || !parsedSelector) {
    return {
      response: invalidRequestResponse("Invalid provider."),
      retryable: true,
    };
  }
  const { providerName, profile } = parsedSelector;

  const providerError = createProviderConfigurationErrorResponse(
    providerSelector,
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
    providerSelector,
  );
  const aiGatewayProvider =
    aiGateway &&
    !providerInstance.requiresCustomAiGatewayProvider &&
    CloudflareAIGateway.isSupportedProvider(providerName, true)
      ? providerName
      : undefined;
  // Retain request-level Gateway controls only when this provider will use
  // AI Gateway. Direct provider requests must not receive Cloudflare metadata.
  const willUseAiGateway = Boolean(
    aiGateway &&
    (aiGateway.alwaysUse ||
      (!providerInstance.requiresCustomAiGatewayProvider &&
        CloudflareAIGateway.isSupportedProvider(providerName))),
  );
  const sanitizedHeaders = stripProxyAuthorizationHeaders(requestHeaders, {
    preserveAiGatewayHeaders: willUseAiGateway,
  });
  if (willUseAiGateway) {
    addProxyAiGatewayMetadata(sanitizedHeaders, {
      provider: providerName,
      model,
      endpoint,
      virtualModel,
    });
  }
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
      credentialProfile: profile,
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
  const routeMetadata = (
    viaAiGateway: boolean,
    selectedIndex = apiKeyIndex,
  ): ChatResponseRouteMetadata => ({
    provider: providerName,
    model,
    credentialProfile: profile,
    ...(configuredApiKeys.length > 0 ? { credentialIndex: selectedIndex } : {}),
    viaAiGateway,
    ...(viaAiGateway && aiGateway ? { gateway: aiGateway.gatewayId } : {}),
  });

  // Generate chat completions request
  const supportedRequestBody = providerInstance.filterSupportedChatParameters({
    ...chatRequestBody,
    model,
  });

  // If AI Gateway is enabled and the provider supports it, use AI Gateway
  if (aiGateway && aiGatewayProvider) {
    let selectedApiKeyIndex = apiKeyIndex;
    const eligibleApiKeyIndexes =
      getEligibleApiKeyIndexes(providerSelector, configuredApiKeys.length) ??
      Array.from(
        { length: configuredApiKeys.length },
        (_value, index) => index,
      );
    const remainingApiKeyIndexes = shuffleArray(
      eligibleApiKeyIndexes.filter(
        (candidateIndex) => candidateIndex !== apiKeyIndex,
      ),
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
    gatewayRequests.forEach(([, requestInit], attemptIndex) => {
      const headers = new Headers(requestInit.headers);
      addProxyAiGatewayMetadata(headers, {
        credentials: {
          credentialProfile: profile,
          providerKeyIndex:
            configuredApiKeys.length === 0
              ? null
              : // Gateway requests and credential indexes are built one-to-one.
                gatewayApiKeyIndexes[attemptIndex]!,
        },
      });
      requestInit.headers = headers;
    });
    const response = await transformResponse(
      fetchWithTimeout((signal) =>
        fetchCompatibilityFallback(
          gatewayRequests,
          signal,
          /* istanbul ignore next -- Gateway requests and credential indexes are built one-to-one */
          (attemptIndex) => {
            selectedApiKeyIndex = gatewayApiKeyIndexes[attemptIndex] ?? 0;
            return {
              ...recordSelection(selectedApiKeyIndex),
              model: loggedModel,
            };
          },
          (attemptIndex, attemptResponse) =>
            recordApiKeyOutcome(
              providerSelector,
              gatewayApiKeyIndexes[attemptIndex] ?? 0,
              configuredApiKeys.length,
              attemptResponse.status,
            ),
        ),
      ),
    );
    return {
      response,
      retryable: isRetryableCandidateStatus(response.status),
      route: routeMetadata(true, selectedApiKeyIndex),
    };
  }

  if (willUseAiGateway) {
    addProxyAiGatewayMetadata(sanitizedHeaders, {
      credentials: {
        credentialProfile: profile,
        providerKeyIndex: configuredApiKeys.length === 0 ? null : apiKeyIndex,
      },
    });
  }

  const [requestInfo, requestInit] =
    await providerInstance.buildChatCompletionsRequest({
      body: "",
      preparedData: supportedRequestBody,
      headers: sanitizedHeaders,
      apiKeyIndex,
    });

  const keyLogFields = recordSelection(apiKeyIndex);
  const completeGatewayRequest = async ([url, gatewayInit]: [
    RequestInfo,
    RequestInit,
  ]): Promise<ChatCompletionAttemptResult> => {
    const response = await transformResponse(
      RequestLogger.withFields(
        { ...keyLogFields, via_ai_gateway: true, model: loggedModel },
        () =>
          fetchWithTimeout((signal) =>
            fetchCompatibilityFallback([[url, gatewayInit]], signal),
          ),
      ),
    );
    recordApiKeyOutcome(
      providerSelector,
      apiKeyIndex,
      configuredApiKeys.length,
      response.status,
    );
    return {
      response,
      retryable: isRetryableCandidateStatus(response.status),
      route: routeMetadata(true),
    };
  };

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
      return completeGatewayRequest(
        aiGateway.buildProviderEndpointRequest({
          provider: providerName,
          method: init.method,
          path,
          body: init.body,
          headers: init.headers ?? {},
        }),
      );
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
    return completeGatewayRequest(
      aiGateway.buildProviderEndpointRequest({
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
      }),
    );
  }

  // Request to the provider endpoint
  const response = await transformResponse(
    RequestLogger.withFields({ ...keyLogFields, model: loggedModel }, () =>
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
  recordApiKeyOutcome(
    providerSelector,
    apiKeyIndex,
    configuredApiKeys.length,
    response.status,
  );
  return {
    response,
    retryable: isRetryableCandidateStatus(response.status),
    route: routeMetadata(false),
  };
}
