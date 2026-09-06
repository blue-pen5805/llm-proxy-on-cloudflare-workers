import { CloudflareAIGateway } from "../ai_gateway";
import {
  customGatewayPath,
  resolveGatewayProvider,
} from "../ai_gateway/custom_provider";
import { addProxyAiGatewayMetadata } from "../ai_gateway/metadata";
import { parseProviderSelector } from "../providers/profile";
import type { RoutedRequestContext } from "../request_context";
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
import {
  fetchCompatibilityFallback,
  MAX_COMPATIBILITY_FALLBACK_ATTEMPTS,
} from "./compatibility_fallback";
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

export interface ProtocolConversion {
  prepareChat(): (Record<string, unknown> & { model: string }) | Response;
  transformResponse(response: Response): Promise<Response>;
}

export interface PreparedChatCompletionsRequest {
  body: Record<string, unknown> & { model: string };
  endpoint?: "messages" | "responses";
  headers: HeadersInit;
  responseMetadataEnabled: boolean;
  conversion?: ProtocolConversion;
}

async function finalizeChatResponse(
  result: ChatCompletionAttemptResult,
  responseMetadataEnabled: boolean,
  requestedModel: string,
  startedAt: string,
  startedAtPerformance: number,
  conversion?: ProtocolConversion,
): Promise<Response> {
  // Native protocol responses retain their JSON/SSE bytes, including provider fields.
  if (result.nativeProtocol) return result.response;
  const response =
    !result.route || !responseMetadataEnabled
      ? result.response
      : await enrichChatResponseWithMetadata({
          response: result.response,
          route: result.route,
          requestedModel,
          requestId: RequestLogger.requestId(),
          startedAt,
          startedAtPerformance,
        });
  return conversion ? conversion.transformResponse(response) : response;
}

export async function handleChatCompletionsRequest(
  context: RoutedRequestContext,
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
  const modelSeparatorIndex = requestedModel.indexOf("/");
  const providerSelector =
    modelSeparatorIndex === -1
      ? requestedModel
      : requestedModel.slice(0, modelSeparatorIndex);
  const parsedProviderSelector = parseProviderSelector(providerSelector);
  const providerInstance = resolveProvider(context, providerSelector);
  const virtualModels = providerInstance ? undefined : Config.virtualModels();
  const candidates = virtualModels?.[requestedModel];
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
        undefined,
        preparedRequest?.conversion,
      );
      return finalizeChatResponse(
        result,
        responseMetadataEnabled,
        requestedModel,
        startedAt,
        startedAtPerformance,
        preparedRequest?.conversion,
      );
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
    undefined,
    preparedRequest?.conversion,
  );
  return finalizeChatResponse(
    result,
    responseMetadataEnabled,
    requestedModel,
    startedAt,
    startedAtPerformance,
    preparedRequest?.conversion,
  );
}

async function attemptResolvedChatCompletion(
  context: RoutedRequestContext,
  aiGateway: CloudflareAIGateway | undefined,
  chatRequestBody: Record<string, unknown> & { model: string },
  requestedModel: string,
  virtualModels: VirtualModels,
  virtualModel: string,
  endpoint:
    | NonNullable<PreparedChatCompletionsRequest["endpoint"]>
    | "chat_completions",
  resolving: ReadonlySet<string>,
  requestHeaders: HeadersInit,
  inheritedTimeout?: number,
  conversion?: ProtocolConversion,
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
      conversion,
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
      conversion,
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
        conversion,
      ),
    context.request.signal,
  );
}

async function attemptChatCompletion(
  context: RoutedRequestContext,
  aiGateway: CloudflareAIGateway | undefined,
  chatRequestBody: Record<string, unknown> & { model: string },
  requestedModel: string,
  requestHeaders: HeadersInit,
  endpoint:
    | NonNullable<PreparedChatCompletionsRequest["endpoint"]>
    | "chat_completions",
  timeout?: number,
  virtualModel?: string,
  conversion?: ProtocolConversion,
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
  const resolved = providerInstance.resolveInference(model, endpoint);
  if (!resolved) {
    return {
      response: invalidRequestResponse(
        `${providerName} does not support ${endpoint}.`,
      ),
      retryable: true,
    };
  }
  const operation = resolved.endpoint;
  if (operation.requiresAiGateway && !aiGateway) {
    return {
      response: invalidRequestResponse(
        `${providerName} requires Cloudflare AI Gateway for ${endpoint}.`,
        503,
      ),
      retryable: true,
    };
  }

  // Get API key apiKeyIndex
  const apiKeyIndex = await selectApiKeyIndex(
    providerInstance,
    contextApiKeyIndex,
    "rotate",
    providerSelector,
  );
  const aiGatewayProvider = resolveGatewayProvider(
    operation.upstream?.name ?? providerName,
    aiGateway,
    !operation.upstream &&
      operation.supportsAiGateway !== false &&
      !providerInstance.requiresCustomAiGatewayProvider &&
      CloudflareAIGateway.isSupportedProvider(providerName),
  );
  const nativeGateway = aiGatewayProvider === providerName;
  const willUseAiGateway = aiGatewayProvider !== undefined;
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
      viaAiGateway: willUseAiGateway,
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

  // Resolve before conversion so native requests retain their complete payload.
  const preparedBody = resolved.native
    ? chatRequestBody
    : (conversion?.prepareChat() ?? chatRequestBody);
  if (preparedBody instanceof Response)
    return { response: preparedBody, retryable: false };
  if (conversion && !resolved.native) {
    sanitizedHeaders.delete("anthropic-version");
    sanitizedHeaders.delete("anthropic-beta");
  }
  const supportedRequestBody = { ...preparedBody, model };
  const transformResponse = async (response: Response): Promise<Response> =>
    operation.transformResponse
      ? operation.transformResponse.call(
          providerInstance,
          response,
          model,
          supportedRequestBody,
        )
      : response;
  const buildRequest = (selectedIndex?: number) =>
    operation.buildRequest.call(providerInstance, {
      data: supportedRequestBody,
      headers: sanitizedHeaders,
      apiKeyIndex: selectedIndex,
      target: aiGatewayProvider
        ? nativeGateway
          ? "gateway"
          : "custom-gateway"
        : "direct",
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
        : contextApiKeyIndex === undefined && nativeGateway
          ? [apiKeyIndex, ...remainingApiKeyIndexes]
          : [apiKeyIndex];
    const compatibilityAttempts =
      configuredApiKeys.length === 0
        ? [undefined]
        : gatewayApiKeyIndexes.slice(0, MAX_COMPATIBILITY_FALLBACK_ATTEMPTS);
    const gatewayRequests = compatibilityAttempts.map(
      (candidateIndex) => async (): Promise<[RequestInfo, RequestInit]> => {
        const [path, init] = await buildRequest(candidateIndex);
        const headers = new Headers(init.headers);
        addProxyAiGatewayMetadata(headers, {
          credentials: {
            credentialProfile: profile,
            providerKeyIndex: candidateIndex ?? null,
          },
        });
        return operation.transport === "workers-ai-rest"
          ? aiGateway.buildWorkersAiInferenceRequest({
              path,
              body: init.body,
              headers,
            })
          : aiGateway.buildProviderEndpointRequest({
              provider: aiGatewayProvider,
              path: nativeGateway
                ? path
                : customGatewayPath(
                    operation.upstream ?? providerInstance,
                    path,
                  ),
              method: init.method,
              body: init.body,
              headers,
            });
      },
    );
    const upstreamResponse = await fetchWithTimeout((signal) =>
      fetchCompatibilityFallback(
        gatewayRequests,
        signal,
        /* istanbul ignore next -- Gateway requests and credential indexes are built one-to-one */
        (attemptIndex) => {
          return {
            ...recordSelection(gatewayApiKeyIndexes[attemptIndex] ?? 0),
            model: loggedModel,
          };
        },
        (attemptIndex, attemptResponse) => {
          // Fallback may return this response after later network errors.
          // Response metadata must identify the last received HTTP response,
          // while beforeAttempt continues to log every attempted credential.
          selectedApiKeyIndex = gatewayApiKeyIndexes[attemptIndex] ?? 0;
          recordApiKeyOutcome(
            providerSelector,
            selectedApiKeyIndex,
            configuredApiKeys.length,
            attemptResponse.status,
          );
        },
      ),
    );
    const response = await transformResponse(upstreamResponse);
    return {
      response,
      retryable: isRetryableCandidateStatus(response.status),
      route: routeMetadata(true, selectedApiKeyIndex),
      nativeProtocol: Boolean(resolved.native && conversion),
    };
  }

  const [url, init] = await buildRequest(apiKeyIndex);
  const keyLogFields = recordSelection(apiKeyIndex);
  const response = await transformResponse(
    await RequestLogger.withFields(
      { ...keyLogFields, model: loggedModel },
      () =>
        fetchWithTimeout((signal) =>
          providerInstance.send(url, { ...init, signal }),
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
    nativeProtocol: Boolean(resolved.native && conversion),
  };
}
