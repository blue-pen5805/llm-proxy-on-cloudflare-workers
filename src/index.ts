import * as process from "node:process";
import { authenticate } from "./utils/authorization";
import { getPathname } from "./utils/utils";
import { AiGatewayEndpoint } from "./providers/ai_gateway";
import { models } from "./requests/models";
import { Secrets } from "./utils/secrets";
import { chatCompletions } from "./requests/chat_completions";
import { Providers } from "./providers";
import { proxy } from "./requests/proxy";
import { universalEndpoint } from "./requests/universal_endpoint";
import { handleOptions } from "./requests/options";

export default {
  async fetch(request, env, _ctx): Promise<Response> {
    if (request.method === "OPTIONS") {
      return handleOptions(request);
    }

    Secrets.configure(env);

    let pathname = getPathname(request);
    if (env.DEV !== "True" && authenticate(request) === false) {
      return new Response("Unauthorized", { status: 401 });
    }

    // AI Gateway routes
    // Example: /g/{AI_GATEWAY_NAME}/chat/completions
    if (pathname.startsWith("/g/")) {
      const [_empty, _g, ai_gateway_name, ...paths] = pathname.split("/");
      pathname = `/${paths.join("/")}`;

      AiGatewayEndpoint.configure(
        env.CLOUDFLARE_ACCOUNT_ID,
        ai_gateway_name,
        env.CF_AIG_TOKEN,
      );
    } else {
      AiGatewayEndpoint.configure(
        env.CLOUDFLARE_ACCOUNT_ID,
        env.AI_GATEWAY_NAME,
        env.CF_AIG_TOKEN,
      );
    }

    // Proxy
    // Example: /openai/v1/chat/completions
    //          /google-ai-studio/v1beta/models/{MODEL_NAME}:generateContent
    const providerName = Object.keys(Providers).find((providerName) =>
      pathname.startsWith(`/${providerName}/`),
    );
    if (providerName) {
      return await proxy(request, providerName, pathname);
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
