import { CloudflareAIGateway } from "../../ai_gateway";
import type { RoutedRequestContext } from "../../request_context";
import { Config } from "../../utils/config";
import { AppError } from "../../utils/error";
import { readRequestText } from "../../utils/helpers";
import { RequestLogger } from "../../utils/logger";
import { handleChatCompletionsRequest } from "../chat_completions";
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
  if (!response.ok) return response;
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  return contentType.includes("text/event-stream")
    ? convertStreamingResponse(response, request, responseMetadataEnabled)
    : convertJsonResponse(response, request, responseMetadataEnabled);
}

/** Translate Anthropic Messages requests onto the existing Chat Completions flow. */
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
  let converted: ReturnType<typeof convertMessagesRequest>;
  try {
    converted = convertMessagesRequest(parsed);
  } catch (error) {
    RequestLogger.start({ endpoint: "messages" });
    return invalidRequest((error as Error).message);
  }

  const headers = new Headers(context.request.headers);
  headers.delete("content-length");
  headers.delete("anthropic-version");
  headers.delete("anthropic-beta");
  const responseMetadataEnabled = Config.chatResponseMetadataEnabled();
  const chatResponse = await handleChatCompletionsRequest(context, aiGateway, {
    body: converted.chat,
    endpoint: "messages",
    headers,
    responseMetadataEnabled,
  });
  return convertChatResponse(
    chatResponse,
    converted.request,
    responseMetadataEnabled,
  );
}
