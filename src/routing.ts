import { Hono } from "hono";
import { CLOUDFLARE_AI_GATEWAY_REST_API_PATHS } from "./ai_gateway/const";
import { isCloudflareAIGatewayRestApiPath } from "./ai_gateway/utils";
import type { RoutedRequestContext } from "./request_context";
import { handleAiGatewayRestRequest } from "./requests/ai_gateway_rest";
import { handleChatCompletionsRequest } from "./requests/chat_completions";
import { handleCompatibilityRequest } from "./requests/compat";
import { anthropicErrorResponse } from "./requests/error_response";
import { handleMessagesRequest } from "./requests/messages";
import {
  handleModelRetrieveRequest,
  handleModelsRequest,
} from "./requests/models";
import { handleProviderProxyRequest } from "./requests/proxy";
import { NO_STORE_HEADERS } from "./requests/response";
import { handleResponsesRequest } from "./requests/responses";
import { handleStatusRequest } from "./requests/status";
import { handleUniversalEndpointRequest } from "./requests/universal_endpoint";
import { handleVirtualModelsRequest } from "./requests/virtual_models";
import {
  BadRequestError,
  MethodNotAllowedError,
  NotFoundError,
} from "./utils/error";
import { RequestLogger } from "./utils/logger";

export const PROVIDER_PROXY_METHODS = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
] as const;
const providerMethods = new Set<string>(PROVIDER_PROXY_METHODS);

function rejectKeySelection(state: RoutedRequestContext): void {
  if (state.apiKeyIndex !== undefined) {
    throw new BadRequestError(
      "API key selection is not supported for this route.",
    );
  }
}

// Bindings carry authenticated request state into this routing stage. getPath
// leaves the original Request, URL encoding, query suffix, and body untouched.
const routes = new Hono<{ Bindings: RoutedRequestContext }>({
  getPath: (_request, options) => options!.env!.pathname.split("?")[0],
});
// The outer request boundary owns the protocol-specific safe error envelope.
routes.onError((err) => {
  throw err;
});

routes.get("/ping", (c) => {
  rejectKeySelection(c.env);
  RequestLogger.start({ endpoint: "ping" });
  return new Response("Pong", { status: 200, headers: NO_STORE_HEADERS });
});

routes.get("/status", (c) => {
  const state = c.env;
  rejectKeySelection(state);
  RequestLogger.start({ endpoint: "status" });
  return handleStatusRequest(state.aiGateway, state.providers, state);
});

routes.get("/virtual-models", (c) => {
  rejectKeySelection(c.env);
  RequestLogger.start({ endpoint: "virtual_models" });
  return handleVirtualModelsRequest(c.env);
});

routes.post("/compat/chat/completions", async (c, next) => {
  const { request, aiGateway } = c.env;
  if (!aiGateway) return await next();
  rejectKeySelection(c.env);
  RequestLogger.start({ endpoint: "ai_gateway_compatibility" });
  return await handleCompatibilityRequest(request, aiGateway);
});

// With Gateway selected this namespace cannot fall through to a provider.
routes.on("ALL", ["/compat", "/compat/*"], async (c, next) => {
  if (c.env.aiGateway) {
    rejectKeySelection(c.env);
    throw new NotFoundError();
  }
  await next();
});

routes.on("POST", [...CLOUDFLARE_AI_GATEWAY_REST_API_PATHS], (c) => {
  const { request, pathname, aiGateway } = c.env;
  rejectKeySelection(c.env);
  // REST paths are exact, including the absence of a query string.
  if (!isCloudflareAIGatewayRestApiPath(pathname)) throw new NotFoundError();
  if (!aiGateway) {
    throw new BadRequestError(
      "AI Gateway REST API requires CLOUDFLARE_ACCOUNT_ID.",
    );
  }
  RequestLogger.start({ endpoint: "ai_gateway_rest" });
  return handleAiGatewayRestRequest(request, pathname, aiGateway);
});

routes.on("ALL", ["/ai", "/ai/*"], (c) => {
  rejectKeySelection(c.env);
  throw new NotFoundError();
});

routes.on("POST", ["/chat/completions", "/v1/chat/completions"], (c) =>
  handleChatCompletionsRequest(c.env, c.env.aiGateway),
);
routes.on("POST", ["/responses", "/v1/responses"], (c) =>
  handleResponsesRequest(c.env, c.env.aiGateway),
);
routes.on("POST", ["/messages", "/v1/messages"], (c) =>
  handleMessagesRequest(c.env, c.env.aiGateway),
);
routes.on(
  "POST",
  ["/messages/count_tokens", "/v1/messages/count_tokens"],
  (c) => {
    rejectKeySelection(c.env);
    RequestLogger.start({ endpoint: "messages_count_tokens" });
    return anthropicErrorResponse(
      "Messages count_tokens is not supported by this compatibility endpoint.",
      400,
      "invalid_request_error",
    );
  },
);
routes.on("GET", ["/models", "/v1/models"], (c) => {
  RequestLogger.start({ endpoint: "models" });
  return handleModelsRequest(c.env, c.env.aiGateway);
});
routes.on("GET", ["/models/:modelId{.+}", "/v1/models/:modelId{.+}"], (c) => {
  let modelId: string;
  try {
    // Decode strictly once; malformed escapes retain the 400 contract.
    modelId = decodeURIComponent(
      c.req.path.replace(/^\/(?:v1\/)?models\//, ""),
    );
  } catch {
    throw new BadRequestError("Invalid model identifier.");
  }
  RequestLogger.start({ endpoint: "model_retrieve" });
  return handleModelRetrieveRequest(c.env, modelId, c.env.aiGateway);
});

routes.post("/", (c) => {
  const { request, aiGateway, providers } = c.env;
  rejectKeySelection(c.env);
  if (!aiGateway) throw new NotFoundError();
  RequestLogger.start({ endpoint: "universal" });
  return handleUniversalEndpointRequest(request, aiGateway, providers);
});

// Provider names and destination paths are resolved only against the operator's
// registry. Hono handles the HTTP dispatch; the registry owns provider policy.
routes.all("*", (c) => {
  const state = c.env;
  const providerRoute = state.providers.match(state.pathname);
  if (providerRoute) {
    if (!providerMethods.has(state.request.method)) {
      throw new MethodNotAllowedError(PROVIDER_PROXY_METHODS);
    }
    return handleProviderProxyRequest(
      state,
      providerRoute.providerName,
      providerRoute.pathname,
      state.aiGateway,
    );
  }
  rejectKeySelection(state);
  throw new NotFoundError();
});

export default routes;
