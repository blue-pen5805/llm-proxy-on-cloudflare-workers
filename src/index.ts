import { CloudflareAIGateway } from "./ai_gateway";
import { Providers } from "./providers";
import { chatCompletions } from "./requests/chat_completions";
import { models } from "./requests/models";
import { handleOptions } from "./requests/options";
import { proxy } from "./requests/proxy";
import { universalEndpoint } from "./requests/universal_endpoint";
import { authenticate } from "./utils/authorization";
import { Config } from "./utils/config";
import { getPathname } from "./utils/helpers";

export default {
  async fetch(request, _env, _ctx): Promise<Response> {
    if (request.method === "OPTIONS") {
      return handleOptions(request);
    }

    let pathname = getPathname(request);
    if (!Config.isDevelopment() && authenticate(request) === false) {
      return new Response("Unauthorized", { status: 401 });
    }

    // Ping
    // Example: /ping
    if (pathname === "/ping") {
      return new Response("Pong", { status: 200 });
    }

    // Setup AI Gateway
    const { accountId, name, token } = Config.aiGateway();
    CloudflareAIGateway.configure({
      accountId,
      gatewayId: name,
      apiKey: token,
    });

    // AI Gateway routes
    // Example: /g/{AI_GATEWAY_NAME}/chat/completions
    if (pathname.startsWith("/g/")) {
      const [_empty, _g, aiGatewayName, ...paths] = pathname.split("/");
      pathname = `/${paths.join("/")}`;

      CloudflareAIGateway.configure({
        gatewayId: aiGatewayName,
      });
    }

    // Initialize AI Gateway
    const aiGateway = CloudflareAIGateway.isAvailable()
      ? new CloudflareAIGateway()
      : undefined;

    // OpenAI compatible endpoints
    // Chat Completions - https://platform.openai.com/docs/api-reference/chat
    if (
      request.method === "POST" &&
      (pathname === "/chat/completions" || pathname === "/v1/chat/completions")
    ) {
      return await chatCompletions(request, aiGateway);
    }
    // Models - https://platform.openai.com/docs/api-reference/models
    if (
      request.method === "GET" &&
      (pathname === "/models" || pathname === "/v1/models")
    ) {
      return await models(aiGateway);
    }

    // Proxy
    // Example: /openai/v1/chat/completions
    //          /google-ai-studio/v1beta/models/{MODEL_NAME}:generateContent
    const providerName = Object.keys(Providers).find((providerName) =>
      pathname.startsWith(`/${providerName}/`),
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
    if (aiGateway && request.method === "POST" && pathname === "/") {
      return await universalEndpoint(request, aiGateway);
    }

    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
