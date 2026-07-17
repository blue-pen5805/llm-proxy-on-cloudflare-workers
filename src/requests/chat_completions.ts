import { CloudflareAIGateway } from "../ai_gateway";
import { MiddlewareContext } from "../middleware";
import {
  determineApiKeySelectionPolicy,
  recordApiKeySelection,
  selectApiKeyIndex,
} from "../utils/api_key_selection";
import { stripProxyAuthorizationHeaders } from "../utils/authorization";
import { Config } from "../utils/config";
import { parseJsonOrReturnText, readRequestText } from "../utils/helpers";
import { RequestLogger } from "../utils/logger";
import { fetchCompatibilityFallback } from "./compatibility_fallback";
import {
  createProviderConfigurationErrorResponse,
  resolveProvider,
} from "./provider_request";

export async function handleChatCompletionsRequest(
  context: MiddlewareContext,
  aiGateway: CloudflareAIGateway | undefined = undefined,
) {
  const { request, apiKeyIndex: contextApiKeyIndex } = context;
  // Remove proxy credentials before adding provider-specific authentication.
  const sanitizedHeaders = stripProxyAuthorizationHeaders(request.headers);

  // Validate Request Data Structure
  const parsedRequestBody = parseJsonOrReturnText(
    await readRequestText(request),
  );
  if (
    typeof parsedRequestBody !== "object" ||
    parsedRequestBody === null ||
    typeof (parsedRequestBody as Record<string, unknown>).model !== "string"
  ) {
    return new Response(
      JSON.stringify({
        error: "Invalid request.",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Split model into provider and model name
  const chatRequestBody = parsedRequestBody as Record<string, unknown> & {
    model: string;
  };
  const requestedModel =
    chatRequestBody.model === "default"
      ? Config.defaultModel()
      : chatRequestBody.model;
  if (!requestedModel) {
    return new Response(JSON.stringify({ error: "Invalid request." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const [providerName, ...modelParts] = requestedModel.split("/");
  const model = modelParts.join("/");

  // Validate provider name
  const providerInstance = resolveProvider(context, providerName);
  if (!providerInstance) {
    return new Response(
      JSON.stringify({
        error: "Invalid provider.",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const providerError = createProviderConfigurationErrorResponse(
    providerName,
    providerInstance,
    aiGateway,
  );
  if (providerError) {
    return providerError;
  }

  // Get API key apiKeyIndex
  const apiKeyIndex = await selectApiKeyIndex(
    providerInstance,
    contextApiKeyIndex,
    "rotate",
  );
  const aiGatewayProvider =
    aiGateway && CloudflareAIGateway.isSupportedProvider(providerName, true)
      ? providerName
      : undefined;
  const keyLogFields = recordApiKeySelection({
    provider: providerName,
    operation: "chat_completions",
    keyIndex: apiKeyIndex,
    keyCount: providerInstance.getApiKeys().length,
    selectionPolicy: determineApiKeySelectionPolicy(
      contextApiKeyIndex,
      "rotate",
    ),
    viaAiGateway:
      aiGatewayProvider !== undefined ||
      Boolean(aiGateway && providerInstance.supportsAiGatewayNativeChat),
  });

  // Generate chat completions request
  const supportedRequestBody = providerInstance.filterSupportedChatParameters({
    ...chatRequestBody,
    model,
  });
  const [requestInfo, requestInit] =
    await providerInstance.buildChatCompletionsRequest({
      body: "",
      preparedData: supportedRequestBody,
      headers: sanitizedHeaders,
      apiKeyIndex,
    });

  // If AI Gateway is enabled and the provider supports it, use AI Gateway
  if (aiGateway && aiGatewayProvider) {
    const gatewayRequests = await aiGateway.buildChatCompletionsRequests({
      provider: aiGatewayProvider,
      body: requestInit.body as string,
      parsedBody: supportedRequestBody as {
        model: string;
        [key: string]: unknown;
      },
      headers: requestInit.headers ?? {},
      apiKeys:
        providerInstance.getAiGatewayApiKeys?.() ??
        providerInstance.getApiKeys(),
    });
    return RequestLogger.withFields(keyLogFields, () =>
      fetchCompatibilityFallback(gatewayRequests, request.signal),
    );
  }

  // Some Gateway providers (notably Azure OpenAI) require account-specific
  // path segments and are not represented by the Compatibility Endpoint.
  if (aiGateway && CloudflareAIGateway.isSupportedProvider(providerName)) {
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
      return RequestLogger.withFields(
        { ...keyLogFields, via_ai_gateway: true },
        () => fetchCompatibilityFallback([[url, gatewayInit]], request.signal),
      );
    }
  }

  // Request to the provider endpoint
  return RequestLogger.withFields(keyLogFields, () =>
    providerInstance.fetch(
      requestInfo,
      {
        ...requestInit,
        signal: request.signal,
      },
      apiKeyIndex,
    ),
  );
}
