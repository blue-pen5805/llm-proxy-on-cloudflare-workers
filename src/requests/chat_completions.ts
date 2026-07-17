import { CloudflareAIGateway } from "../ai_gateway";
import { MiddlewareContext } from "../middleware";
import { getProvider } from "../providers";
import {
  apiKeySelectionPolicy,
  recordApiKeySelection,
  selectApiKeyIndex,
} from "../utils/api_key_selection";
import { stripProxyAuthorizationHeaders } from "../utils/authorization";
import { Config } from "../utils/config";
import { Environments } from "../utils/environments";
import { safeJsonParse } from "../utils/helpers";
import { RequestLogger } from "../utils/logger";
import { fetchCompatibilityFallback } from "./compatibility_fallback";

export async function chatCompletions(
  context: MiddlewareContext,
  aiGateway: CloudflareAIGateway | undefined = undefined,
) {
  const { request, apiKeyIndex: contextApiKeyIndex } = context;
  // Remove proxy credentials before adding provider-specific authentication.
  const headers = stripProxyAuthorizationHeaders(request.headers);

  // Validate Request Data Structure
  const data = safeJsonParse(await request.text());
  if (
    typeof data !== "object" ||
    data === null ||
    typeof (data as Record<string, unknown>).model !== "string"
  ) {
    return new Response(
      JSON.stringify({
        error: "Invalid request.",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Split model into provider and model name
  const requestData = data as Record<string, unknown> & { model: string };
  const requestedModel =
    requestData.model === "default" ? Config.defaultModel() : requestData.model;
  if (!requestedModel) {
    return new Response(JSON.stringify({ error: "Invalid request." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const [providerName, ...modelParts] = requestedModel.split("/");
  const model = modelParts.join("/");

  // Validate provider name
  const provider = context.providers
    ? context.providers.get(providerName)
    : getProvider(providerName, Environments.all());
  if (!provider) {
    return new Response(
      JSON.stringify({
        error: "Invalid provider.",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  if (provider.requiresAiGateway && !aiGateway) {
    return new Response(
      JSON.stringify({
        error: `${providerName} requires Cloudflare AI Gateway.`,
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
  if (provider.requiresAuthenticatedAiGateway && !aiGateway?.apiKey) {
    return new Response(
      JSON.stringify({ error: `${providerName} requires CF_AIG_TOKEN.` }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
  const configurationError = provider.configurationError?.();
  if (configurationError) {
    return new Response(JSON.stringify({ error: configurationError }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (provider.requiresProviderCredentials && !provider.available()) {
    return new Response(
      JSON.stringify({
        error: `${providerName} requires ${String(provider.apiKeyName)}.`,
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Get API key apiKeyIndex
  const apiKeyIndex = await selectApiKeyIndex(
    provider,
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
    keyCount: provider.getApiKeys().length,
    selectionPolicy: apiKeySelectionPolicy(contextApiKeyIndex, "rotate"),
    viaAiGateway:
      aiGatewayProvider !== undefined ||
      Boolean(aiGateway && provider.supportsAiGatewayNativeChat),
  });

  // Generate chat completions request
  const filteredData = provider.filterChatCompletionsRequest({
    ...requestData,
    model,
  });
  const [requestInfo, requestInit] = await provider.buildChatCompletionsRequest(
    {
      body: "",
      preparedData: filteredData,
      headers,
      apiKeyIndex,
    },
  );

  // If AI Gateway is enabled and the provider supports it, use AI Gateway
  if (aiGateway && aiGatewayProvider) {
    const gatewayRequests = await aiGateway.buildChatCompletionsRequests({
      provider: aiGatewayProvider,
      body: requestInit.body as string,
      parsedBody: filteredData as { model: string; [key: string]: unknown },
      headers: requestInit.headers ?? {},
      apiKeys: provider.getAiGatewayApiKeys?.() ?? provider.getApiKeys(),
    });
    return RequestLogger.withFields(keyLogFields, () =>
      fetchCompatibilityFallback(gatewayRequests, request.signal),
    );
  }

  // Some Gateway providers (notably Azure OpenAI) require account-specific
  // path segments and are not represented by the Compatibility Endpoint.
  if (aiGateway && CloudflareAIGateway.isSupportedProvider(providerName)) {
    const providerRequest = await provider.buildAiGatewayChatCompletionsRequest(
      {
        data: filteredData as Record<string, unknown> & { model: string },
        headers,
        apiKeyIndex,
      },
    );
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
    provider.fetch(
      requestInfo,
      {
        ...requestInit,
        signal: request.signal,
      },
      apiKeyIndex,
    ),
  );
}
