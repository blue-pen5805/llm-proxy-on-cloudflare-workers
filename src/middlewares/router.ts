import { CloudflareAIGateway } from "../ai_gateway";
import { isCloudflareAIGatewayRestApiPath } from "../ai_gateway/utils";
import { Middleware, MiddlewareContext } from "../middleware";
import { createProviderRegistry } from "../providers";
import { handleAiGatewayRestRequest } from "../requests/ai_gateway_rest";
import { handleChatCompletionsRequest } from "../requests/chat_completions";
import { handleCompatibilityRequest } from "../requests/compat";
import { handleMessagesRequest } from "../requests/messages";
import { handleModelsRequest } from "../requests/models";
import { handleProviderProxyRequest } from "../requests/proxy";
import { handleResponsesRequest } from "../requests/responses";
import { handleStatusRequest } from "../requests/status";
import { handleUniversalEndpointRequest } from "../requests/universal_endpoint";
import { handleVirtualModelsRequest } from "../requests/virtual_models";
import { Environments } from "../utils/environments";
import { BadRequestError, NotFoundError } from "../utils/error";
import { RequestLogger } from "../utils/logger";

const COMPAT_PATH_PATTERN = /^\/compat(?:$|\/|\?)/;
const AI_PATH_PATTERN = /^\/ai(?:$|\/|\?)/;

export async function handleRouting(
  context: MiddlewareContext,
  aiGateway?: CloudflareAIGateway,
): Promise<Response> {
  const { request, pathname } = context;
  const rejectUnsupportedKeySelection = (): void => {
    if (context.apiKeyIndex !== undefined) {
      throw new BadRequestError(
        "API key selection is not supported for this route.",
      );
    }
  };
  // Example: /ping
  //          /status
  //          /g/{AI_GATEWAY_NAME}/status
  if (request.method === "GET" && pathname === "/ping") {
    rejectUnsupportedKeySelection();
    RequestLogger.start({ endpoint: "ping" });
    return new Response("Pong", { status: 200 });
  }

  if (request.method === "GET" && pathname === "/status") {
    rejectUnsupportedKeySelection();
    RequestLogger.start({ endpoint: "status" });
    return await handleStatusRequest(aiGateway, context.providers);
  }

  if (request.method === "GET" && pathname === "/virtual-models") {
    rejectUnsupportedKeySelection();
    RequestLogger.start({ endpoint: "virtual_models" });
    return handleVirtualModelsRequest(context);
  }

  if (aiGateway && COMPAT_PATH_PATTERN.test(pathname)) {
    rejectUnsupportedKeySelection();
    // Example: /g/{AI_GATEWAY_NAME}/compat/chat/completions
    if (request.method === "POST" && pathname === "/compat/chat/completions") {
      RequestLogger.start({ endpoint: "ai_gateway_compatibility" });
      return await handleCompatibilityRequest(request, aiGateway);
    }

    throw new NotFoundError();
  }

  if (AI_PATH_PATTERN.test(pathname)) {
    rejectUnsupportedKeySelection();
    if (
      request.method === "POST" &&
      isCloudflareAIGatewayRestApiPath(pathname)
    ) {
      if (!aiGateway) {
        throw new BadRequestError(
          "AI Gateway REST API requires CLOUDFLARE_ACCOUNT_ID.",
        );
      }
      RequestLogger.start({ endpoint: "ai_gateway_rest" });
      return await handleAiGatewayRestRequest(request, pathname, aiGateway);
    }

    throw new NotFoundError();
  }

  // OpenAI compatible endpoints
  // Chat Completions - https://platform.openai.com/docs/api-reference/chat
  // Example: /chat/completions
  //          /v1/chat/completions
  //          /g/{AI_GATEWAY_NAME}/chat/completions
  if (
    request.method === "POST" &&
    (pathname === "/chat/completions" || pathname === "/v1/chat/completions")
  ) {
    return await handleChatCompletionsRequest(context, aiGateway);
  }

  // Responses - https://developers.openai.com/api/reference/resources/responses/methods/create
  // Example: /responses
  //          /v1/responses
  //          /g/{AI_GATEWAY_NAME}/v1/responses
  if (
    request.method === "POST" &&
    (pathname === "/responses" || pathname === "/v1/responses")
  ) {
    return await handleResponsesRequest(context, aiGateway);
  }

  // Messages - https://platform.claude.com/docs/en/api/messages/create
  // Example: /messages
  //          /v1/messages
  //          /g/{AI_GATEWAY_NAME}/v1/messages
  if (
    request.method === "POST" &&
    (pathname === "/messages" || pathname === "/v1/messages")
  ) {
    return await handleMessagesRequest(context, aiGateway);
  }

  // Models - https://platform.openai.com/docs/api-reference/models
  // Example: /models
  //          /v1/models
  //          /g/{AI_GATEWAY_NAME}/models
  if (
    request.method === "GET" &&
    (pathname === "/models" || pathname === "/v1/models")
  ) {
    RequestLogger.start({ endpoint: "models" });
    return await handleModelsRequest(context, aiGateway);
  }

  // Proxy
  // Example: /openai/v1/chat/completions
  //          /google-ai-studio/v1beta/models/{MODEL_NAME}:generateContent
  //          /g/{AI_GATEWAY_NAME}/openai/v1/chat/completions
  const providerRegistry =
    context.providers ?? createProviderRegistry(Environments.all());
  const providerRoute = providerRegistry.match(pathname);
  if (providerRoute) {
    return await handleProviderProxyRequest(
      context,
      providerRoute.providerName,
      providerRoute.pathname,
      aiGateway,
    );
  }

  rejectUnsupportedKeySelection();

  // Universal Endpoint
  // https://developers.cloudflare.com/ai-gateway/usage/universal/
  // Example: /g/{AI_GATEWAY_NAME}/
  if (aiGateway && request.method === "POST" && pathname === "/") {
    return await handleUniversalEndpointRequest(
      request,
      aiGateway,
      providerRegistry,
    );
  }

  throw new NotFoundError();
}

export const routerMiddleware: Middleware = async (context) => {
  return await handleRouting(context, context.aiGateway);
};
