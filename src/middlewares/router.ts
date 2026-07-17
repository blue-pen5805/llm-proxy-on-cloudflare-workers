import { CloudflareAIGateway } from "../ai_gateway";
import { isCloudflareAIGatewayRestApiPath } from "../ai_gateway/utils";
import { Middleware, MiddlewareContext } from "../middleware";
import { createProviderRegistry } from "../providers";
import { aiGatewayRest } from "../requests/ai_gateway_rest";
import { chatCompletions } from "../requests/chat_completions";
import { compat } from "../requests/compat";
import { models } from "../requests/models";
import { proxy } from "../requests/proxy";
import { status } from "../requests/status";
import { universalEndpoint } from "../requests/universal_endpoint";
import { Environments } from "../utils/environments";
import { BadRequestError, NotFoundError } from "../utils/error";

export async function handleRouting(
  context: MiddlewareContext,
  aiGateway?: CloudflareAIGateway,
): Promise<Response> {
  const { request, pathname } = context;
  // Example: /ping
  //          /status
  //          /g/{AI_GATEWAY_NAME}/status
  if (pathname === "/ping") {
    return new Response("Pong", { status: 200 });
  }

  if (pathname === "/status") {
    return await status(aiGateway, context.providers);
  }

  if (aiGateway && /^\/compat(?:$|\/|\?)/.test(pathname)) {
    // Example: /g/{AI_GATEWAY_NAME}/compat/chat/completions
    if (request.method === "POST" && pathname === "/compat/chat/completions") {
      return await compat(request, aiGateway);
    }

    throw new NotFoundError();
  }

  if (/^\/ai(?:$|\/|\?)/.test(pathname)) {
    if (
      request.method === "POST" &&
      isCloudflareAIGatewayRestApiPath(pathname)
    ) {
      if (!aiGateway) {
        throw new BadRequestError(
          "AI Gateway REST API requires CLOUDFLARE_ACCOUNT_ID.",
        );
      }
      return await aiGatewayRest(request, pathname, aiGateway);
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
    return await chatCompletions(context, aiGateway);
  }

  // Models - https://platform.openai.com/docs/api-reference/models
  // Example: /models
  //          /v1/models
  //          /g/{AI_GATEWAY_NAME}/models
  if (
    request.method === "GET" &&
    (pathname === "/models" || pathname === "/v1/models")
  ) {
    return await models(context, aiGateway);
  }

  // Proxy
  // Example: /openai/v1/chat/completions
  //          /google-ai-studio/v1beta/models/{MODEL_NAME}:generateContent
  //          /g/{AI_GATEWAY_NAME}/openai/v1/chat/completions
  const providers =
    context.providers ?? createProviderRegistry(Environments.all());
  const providerRoute = providers.match(pathname);
  if (providerRoute) {
    return await proxy(
      context,
      providerRoute.providerName,
      providerRoute.pathname,
      aiGateway,
    );
  }

  // Universal Endpoint
  // https://developers.cloudflare.com/ai-gateway/usage/universal/
  // Example: /g/{AI_GATEWAY_NAME}/
  if (aiGateway && request.method === "POST" && pathname === "/") {
    return await universalEndpoint(request, aiGateway);
  }

  throw new NotFoundError();
}

export const routerMiddleware: Middleware = async (context) => {
  return await handleRouting(context, context.aiGateway);
};
