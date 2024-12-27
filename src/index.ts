import { authenticate } from "./authorization";
import { getPathname } from "./utils";
import { AiGatewayEndpoint } from "./providers/ai_gateway";
import { models } from "./requests/models";
import { Secrets } from "./secrets";
import { chatCompletions } from "./requests/chat_completions";
import { Providers } from "./providers";
import { proxy } from "./requests/proxy";
import { universalEndpoint } from "./requests/universal_endpoint";

export default {
  async fetch(request, env, _ctx): Promise<Response> {
    const pathname = getPathname(request);
    if (env.DEV !== "True" && authenticate(request, env) === false) {
      return new Response("Unauthorized", { status: 401 });
    }

    Secrets.configure(env);
    AiGatewayEndpoint.configure(
      env.CLOUDFLARE_ACCOUNT_ID,
      env.AI_GATEWAY_NAME,
      env.CF_AIG_TOKEN,
    );

    // Proxy
    // Example: /openai/v1/chat/completions
    //          /google-ai-studio/v1beta/models/{MODEL_NAME}:generateContent
    const providerName = Object.keys(Providers).find((providerName) =>
      pathname.startsWith(`/${providerName}/`),
    );
    if (providerName) {
      return await proxy(request, providerName);
    }

    // OpenAI compatible endpoints
    // Chat Completions - https://platform.openai.com/docs/api-reference/chat
    if (
      request.method === "POST" &&
      (pathname === "/chat/completions" || pathname === "/v1/chat/completions")
    ) {
      return await chatCompletions(request);
    }
    // Models - https://platform.openai.com/docs/api-reference/models
    if (
      request.method === "GET" &&
      (pathname === "/models" || pathname === "/v1/models")
    ) {
      return await models();
    }

    // Universal Endpoint
    // https://developers.cloudflare.com/ai-gateway/providers/universal/
    if (
      AiGatewayEndpoint.isActive() &&
      request.method === "POST" &&
      pathname === "/"
    ) {
      return await universalEndpoint(request);
    }

    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
