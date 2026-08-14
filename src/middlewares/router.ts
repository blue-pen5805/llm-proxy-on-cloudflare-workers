import { CloudflareAIGateway } from "../ai_gateway";
import { Middleware } from "../middleware";
import {
  assertRoutedRequestContext,
  type RoutedRequestContext,
} from "../request_context";
import { handleAiGatewayRestRequest } from "../requests/ai_gateway_rest";
import { handleChatCompletionsRequest } from "../requests/chat_completions";
import { handleCompatibilityRequest } from "../requests/compat";
import { anthropicErrorResponse } from "../requests/error_response";
import { handleMessagesRequest } from "../requests/messages";
import {
  handleModelRetrieveRequest,
  handleModelsRequest,
} from "../requests/models";
import { handleProviderProxyRequest } from "../requests/proxy";
import { NO_STORE_HEADERS, withoutBodyForHead } from "../requests/response";
import { handleResponsesRequest } from "../requests/responses";
import { handleStatusRequest } from "../requests/status";
import { handleUniversalEndpointRequest } from "../requests/universal_endpoint";
import { handleVirtualModelsRequest } from "../requests/virtual_models";
import { resolveRoute, type ResolvedRoute } from "../routing";
import { RequestLogger } from "../utils/logger";

/** Execute a previously resolved route. */
export async function executeRoute(
  context: RoutedRequestContext,
  route: ResolvedRoute,
  aiGateway?: CloudflareAIGateway,
): Promise<Response> {
  const { request } = context;

  switch (route.kind) {
    case "ping":
      RequestLogger.start({ endpoint: "ping" });
      return withoutBodyForHead(
        request,
        new Response("Pong", { status: 200, headers: NO_STORE_HEADERS }),
      );
    case "status":
      RequestLogger.start({ endpoint: "status" });
      return withoutBodyForHead(
        request,
        await handleStatusRequest(aiGateway, context.providers, context),
      );
    case "virtual_models":
      RequestLogger.start({ endpoint: "virtual_models" });
      return withoutBodyForHead(request, handleVirtualModelsRequest(context));
    case "ai_gateway_compatibility":
      RequestLogger.start({ endpoint: "ai_gateway_compatibility" });
      return await handleCompatibilityRequest(request, aiGateway!);
    case "ai_gateway_rest":
      RequestLogger.start({ endpoint: "ai_gateway_rest" });
      return await handleAiGatewayRestRequest(
        request,
        route.pathname,
        aiGateway!,
      );
    case "chat_completions":
      return await handleChatCompletionsRequest(context, aiGateway);
    case "responses":
      return await handleResponsesRequest(context, aiGateway);
    case "messages":
      return await handleMessagesRequest(context, aiGateway);
    case "messages_count_tokens":
      RequestLogger.start({ endpoint: "messages_count_tokens" });
      return anthropicErrorResponse(
        "Messages count_tokens is not supported by this compatibility endpoint.",
        400,
        "invalid_request_error",
      );
    case "models":
      RequestLogger.start({ endpoint: "models" });
      return withoutBodyForHead(
        request,
        await handleModelsRequest(context, aiGateway),
      );
    case "model_retrieve":
      RequestLogger.start({ endpoint: "model_retrieve" });
      return withoutBodyForHead(
        request,
        await handleModelRetrieveRequest(context, route.modelId, aiGateway),
      );
    case "provider_proxy":
      return await handleProviderProxyRequest(
        context,
        route.providerName,
        route.pathname,
        aiGateway,
      );
    case "universal":
      return await handleUniversalEndpointRequest(
        request,
        aiGateway!,
        context.providers,
      );
  }
}

export async function handleRouting(
  context: RoutedRequestContext,
  aiGateway?: CloudflareAIGateway,
): Promise<Response> {
  return await executeRoute(
    context,
    resolveRoute(context, aiGateway !== undefined),
    aiGateway,
  );
}

export const routerMiddleware: Middleware = async (context) => {
  assertRoutedRequestContext(context);
  return await handleRouting(context, context.aiGateway);
};
