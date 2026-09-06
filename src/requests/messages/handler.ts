import type { CloudflareAIGateway } from "../../ai_gateway";
import type { RoutedRequestContext } from "../../request_context";
import { handleCompatibilityRequest } from "../compatibility_handler";
import { convertMessagesRequest, invalidRequest } from "./request";
import { convertJsonResponse } from "./response";
import { convertStreamingResponse } from "./stream";

const protocol = {
  endpoint: "messages" as const,
  invalidRequest,
  convertRequest: convertMessagesRequest,
  convertJsonResponse,
  convertStreamingResponse,
};

export function handleMessagesRequest(
  context: RoutedRequestContext,
  aiGateway: CloudflareAIGateway | undefined = undefined,
): Promise<Response> {
  return handleCompatibilityRequest(context, aiGateway, protocol);
}
