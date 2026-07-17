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
    viaAiGateway: aiGatewayProvider !== undefined,
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
      apiKeyName: provider.apiKeyName as keyof Env,
    });
    return RequestLogger.withFields(keyLogFields, () =>
      fetchCompatibilityFallback(gatewayRequests, request.signal),
    );
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
