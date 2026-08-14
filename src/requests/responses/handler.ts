import { CloudflareAIGateway } from "../../ai_gateway";
import type { RoutedRequestContext } from "../../request_context";
import { Config } from "../../utils/config";
import { AppError } from "../../utils/error";
import { readRequestText } from "../../utils/helpers";
import { RequestLogger } from "../../utils/logger";
import { handleChatCompletionsRequest } from "../chat_completions";
import {
  convertResponsesRequest,
  invalidRequest,
  type ResponsesRequest,
} from "./request";
import { convertJsonResponse } from "./response";
import { convertStreamingResponse } from "./stream";

async function convertChatResponse(
  response: Response,
  request: ResponsesRequest,
  responseMetadataEnabled: boolean,
): Promise<Response> {
  if (!response.ok) return response;
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  return contentType.includes("text/event-stream")
    ? convertStreamingResponse(response, request, responseMetadataEnabled)
    : convertJsonResponse(response, request, responseMetadataEnabled);
}

export async function handleResponsesRequest(
  context: RoutedRequestContext,
  aiGateway: CloudflareAIGateway | undefined = undefined,
): Promise<Response> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readRequestText(context.request)) as unknown;
  } catch (error) {
    if (error instanceof AppError) throw error;
    RequestLogger.start({ endpoint: "responses" });
    return invalidRequest("Request body must be valid JSON.");
  }
  let converted: ReturnType<typeof convertResponsesRequest>;
  try {
    converted = convertResponsesRequest(parsed);
  } catch (error) {
    RequestLogger.start({ endpoint: "responses" });
    return invalidRequest((error as Error).message);
  }

  const headers = new Headers(context.request.headers);
  headers.delete("content-length");
  const responseMetadataEnabled = Config.chatResponseMetadataEnabled();
  const chatResponse = await handleChatCompletionsRequest(context, aiGateway, {
    body: converted.chat,
    endpoint: "responses",
    headers,
    responseMetadataEnabled,
  });
  return convertChatResponse(
    chatResponse,
    converted.request,
    responseMetadataEnabled,
  );
}
