import type { CloudflareAIGatewayRestApiPath } from "./ai_gateway/const";
import {
  isCloudflareAIGatewayRestApiPath,
  isCloudflareAiPath,
} from "./ai_gateway/utils";
import type { RoutedRequestContext } from "./request_context";
import { BadRequestError, NotFoundError } from "./utils/error";

const COMPAT_PATH_PATTERN = /^\/compat(?:$|\/|\?)/;

export type ResolvedRoute =
  | { kind: "ping" }
  | { kind: "status" }
  | { kind: "virtual_models" }
  | { kind: "ai_gateway_compatibility" }
  | { kind: "ai_gateway_rest"; pathname: CloudflareAIGatewayRestApiPath }
  | { kind: "chat_completions" }
  | { kind: "responses" }
  | { kind: "messages" }
  | { kind: "messages_count_tokens" }
  | { kind: "models" }
  | { kind: "model_retrieve"; modelId: string }
  | { kind: "provider_proxy"; providerName: string; pathname: string }
  | { kind: "universal" };

/** Resolve a routed request without invoking a request handler. */
export function resolveRoute(
  context: RoutedRequestContext,
  hasAiGateway: boolean,
): ResolvedRoute {
  const { request, pathname } = context;
  const routePath = pathname.split("?")[0];
  const isGetOrHead = request.method === "GET" || request.method === "HEAD";
  const rejectUnsupportedKeySelection = (): void => {
    if (context.apiKeyIndex !== undefined) {
      throw new BadRequestError(
        "API key selection is not supported for this route.",
      );
    }
  };

  if (isGetOrHead && routePath === "/ping") {
    rejectUnsupportedKeySelection();
    return { kind: "ping" };
  }

  if (isGetOrHead && routePath === "/status") {
    rejectUnsupportedKeySelection();
    return { kind: "status" };
  }

  if (isGetOrHead && routePath === "/virtual-models") {
    rejectUnsupportedKeySelection();
    return { kind: "virtual_models" };
  }

  if (hasAiGateway && COMPAT_PATH_PATTERN.test(pathname)) {
    rejectUnsupportedKeySelection();
    if (request.method === "POST" && pathname === "/compat/chat/completions") {
      return { kind: "ai_gateway_compatibility" };
    }

    throw new NotFoundError();
  }

  if (isCloudflareAiPath(pathname)) {
    rejectUnsupportedKeySelection();
    if (
      request.method === "POST" &&
      isCloudflareAIGatewayRestApiPath(pathname)
    ) {
      if (!hasAiGateway) {
        throw new BadRequestError(
          "AI Gateway REST API requires CLOUDFLARE_ACCOUNT_ID.",
        );
      }
      return { kind: "ai_gateway_rest", pathname };
    }

    throw new NotFoundError();
  }

  if (
    request.method === "POST" &&
    (pathname === "/chat/completions" || pathname === "/v1/chat/completions")
  ) {
    return { kind: "chat_completions" };
  }

  if (
    request.method === "POST" &&
    (pathname === "/responses" || pathname === "/v1/responses")
  ) {
    return { kind: "responses" };
  }

  if (
    request.method === "POST" &&
    (pathname === "/messages" || pathname === "/v1/messages")
  ) {
    return { kind: "messages" };
  }

  if (
    request.method === "POST" &&
    (routePath === "/messages/count_tokens" ||
      routePath === "/v1/messages/count_tokens")
  ) {
    rejectUnsupportedKeySelection();
    return { kind: "messages_count_tokens" };
  }

  if (isGetOrHead && (routePath === "/models" || routePath === "/v1/models")) {
    return { kind: "models" };
  }

  const modelRetrieveMatch = routePath.match(/^\/(?:v1\/)?models\/(.+)$/);
  if (isGetOrHead && modelRetrieveMatch) {
    try {
      return {
        kind: "model_retrieve",
        modelId: decodeURIComponent(modelRetrieveMatch[1]),
      };
    } catch {
      throw new BadRequestError("Invalid model identifier.");
    }
  }

  const providerRoute = context.providers.match(pathname);
  if (providerRoute) {
    return { kind: "provider_proxy", ...providerRoute };
  }

  rejectUnsupportedKeySelection();

  if (hasAiGateway && request.method === "POST" && pathname === "/") {
    return { kind: "universal" };
  }

  throw new NotFoundError();
}
