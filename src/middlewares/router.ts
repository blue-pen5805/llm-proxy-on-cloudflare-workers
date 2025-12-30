import { CloudflareAIGateway } from "../ai_gateway";
import { Middleware } from "../middleware";
import { Providers } from "../providers";
import { chatCompletions } from "../requests/chat_completions";
import { compat } from "../requests/compat";
import { models } from "../requests/models";
import { proxy } from "../requests/proxy";
import { status } from "../requests/status";
import { universalEndpoint } from "../requests/universal_endpoint";
import { NotFoundError } from "../utils/error";

export async function handleRouting(
  request: Request,
  pathname: string,
  aiGateway?: CloudflareAIGateway,
): Promise<Response> {
  // Example: /ping
  //          /status
  //          /g/{AI_GATEWAY_NAME}/status
  if (pathname === "/ping") {
    return new Response("Pong", { status: 200 });
  }

  if (pathname === "/status") {
    return await status(aiGateway);
  }

  // Example: /g/{AI_GATEWAY_NAME}/compat
  if (aiGateway && /^\/compat(?:$|\/|\?)/.test(pathname)) {
    return await compat(request, pathname, aiGateway);
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
    return await chatCompletions(request, aiGateway);
  }

  // Models - https://platform.openai.com/docs/api-reference/models
  // Example: /models
  //          /v1/models
  //          /g/{AI_GATEWAY_NAME}/models
  if (
    request.method === "GET" &&
    (pathname === "/models" || pathname === "/v1/models")
  ) {
    return await models(aiGateway);
  }

  // Proxy
  // Example: /openai/v1/chat/completions
  //          /google-ai-studio/v1beta/models/{MODEL_NAME}:generateContent
  //          /g/{AI_GATEWAY_NAME}/openai/v1/chat/completions
  const providerName = Object.keys(Providers).find((p) =>
    pathname.startsWith(`/${p}/`),
  );
  if (providerName) {
    const targetPathname = pathname.replace(
      new RegExp(`^/${providerName}/`),
      "/",
    );
    return await proxy(request, providerName, targetPathname, aiGateway);
  }

  // Universal Endpoint
  // https://developers.cloudflare.com/ai-gateway/providers/universal/
  // Example: /g/{AI_GATEWAY_NAME}/
  if (aiGateway && request.method === "POST" && pathname === "/") {
    return await universalEndpoint(request, aiGateway);
  }

  throw new NotFoundError();
}

export const routerMiddleware: Middleware = async (context) => {
  return await handleRouting(
    context.request,
    context.pathname,
    context.aiGateway,
  );
};
