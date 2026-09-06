import type { CloudflareAIGateway } from "../ai_gateway";
import type { RoutedRequestContext } from "../request_context";
import { Config } from "../utils/config";
import { AppError } from "../utils/error";
import { readRequestText } from "../utils/helpers";
import { RequestLogger } from "../utils/logger";
import {
  handleChatCompletionsRequest,
  type ProtocolConversion,
} from "./chat_completions";
import { isJsonObject } from "./sse";

interface CompatibilityProtocol<T> {
  endpoint: "responses" | "messages";
  invalidRequest(message: string): Response;
  convertRequest(body: unknown): {
    chat: Record<string, unknown> & { model: string };
    request: T;
  };
  convertJsonResponse(
    response: Response,
    request: T,
    metadata: boolean,
  ): Promise<Response>;
  convertStreamingResponse(
    response: Response,
    request: T,
    metadata: boolean,
  ): Response;
}

export async function handleCompatibilityRequest<T>(
  context: RoutedRequestContext,
  aiGateway: CloudflareAIGateway | undefined,
  protocol: CompatibilityProtocol<T>,
): Promise<Response> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readRequestText(context.request)) as unknown;
  } catch (error) {
    if (error instanceof AppError) throw error;
    RequestLogger.start({ endpoint: protocol.endpoint });
    return protocol.invalidRequest("Request body must be valid JSON.");
  }
  if (!isJsonObject(parsed) || typeof parsed.model !== "string") {
    RequestLogger.start({ endpoint: protocol.endpoint });
    return protocol.invalidRequest("Invalid request.");
  }
  let converted: ReturnType<CompatibilityProtocol<T>["convertRequest"]>;
  const responseMetadataEnabled = Config.chatResponseMetadataEnabled();
  const conversion: ProtocolConversion = {
    prepareChat() {
      try {
        converted ??= protocol.convertRequest(parsed);
        return converted.chat;
      } catch (error) {
        return protocol.invalidRequest((error as Error).message);
      }
    },
    transformResponse(response) {
      if (!response.ok) return Promise.resolve(response);
      const contentType =
        response.headers.get("content-type")?.toLowerCase() ?? "";
      const convert = contentType.includes("text/event-stream")
        ? protocol.convertStreamingResponse
        : protocol.convertJsonResponse;
      return Promise.resolve(
        convert(response, converted.request, responseMetadataEnabled),
      );
    },
  };

  const headers = new Headers(context.request.headers);
  headers.delete("content-length");
  return handleChatCompletionsRequest(context, aiGateway, {
    body: parsed as Record<string, unknown> & { model: string },
    conversion,
    endpoint: protocol.endpoint,
    headers,
    responseMetadataEnabled,
  });
}
