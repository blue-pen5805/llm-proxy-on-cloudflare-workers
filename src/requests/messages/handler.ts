import { CloudflareAIGateway } from "../../ai_gateway";
import type { RoutedRequestContext } from "../../request_context";
import { Config } from "../../utils/config";
import { AppError } from "../../utils/error";
import { readRequestText } from "../../utils/helpers";
import { RequestLogger } from "../../utils/logger";
import {
  handleChatCompletionsRequest,
  type ProtocolConversion,
} from "../chat_completions";
import { isJsonObject } from "../sse";
import {
  convertMessagesRequest,
  invalidRequest,
  type MessagesRequest,
} from "./request";
import { convertJsonResponse } from "./response";
import { convertStreamingResponse } from "./stream";

async function convertChatResponse(
  response: Response,
  request: MessagesRequest,
  responseMetadataEnabled: boolean,
): Promise<Response> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  return contentType.includes("text/event-stream")
    ? convertStreamingResponse(response, request, responseMetadataEnabled)
    : convertJsonResponse(response, request, responseMetadataEnabled);
}

/** Prefer native Messages; use Chat conversion only for other upstream protocols. */
export async function handleMessagesRequest(
  context: RoutedRequestContext,
  aiGateway: CloudflareAIGateway | undefined = undefined,
): Promise<Response> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readRequestText(context.request)) as unknown;
  } catch (error) {
    if (error instanceof AppError) throw error;
    RequestLogger.start({ endpoint: "messages" });
    return invalidRequest("Request body must be valid JSON.");
  }
  if (!isJsonObject(parsed) || typeof parsed.model !== "string") {
    RequestLogger.start({ endpoint: "messages" });
    return invalidRequest("Invalid request.");
  }
  let converted: ReturnType<typeof convertMessagesRequest>;
  const responseMetadataEnabled = Config.chatResponseMetadataEnabled();
  const conversion: ProtocolConversion = {
    prepareChat() {
      try {
        converted ??= convertMessagesRequest(parsed);
        return converted.chat;
      } catch (error) {
        return invalidRequest((error as Error).message);
      }
    },
    transformResponse(response) {
      if (!response.ok) return Promise.resolve(response);
      return convertChatResponse(
        response,
        converted.request,
        responseMetadataEnabled,
      );
    },
  };

  const headers = new Headers(context.request.headers);
  headers.delete("content-length");
  return handleChatCompletionsRequest(context, aiGateway, {
    body: parsed as Record<string, unknown> & { model: string },
    conversion,
    endpoint: "messages",
    headers,
    responseMetadataEnabled,
  });
}
