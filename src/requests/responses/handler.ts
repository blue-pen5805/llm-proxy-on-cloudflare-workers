import type { CloudflareAIGateway } from "../../ai_gateway";
import type { RoutedRequestContext } from "../../request_context";
import { handleCompatibilityRequest } from "../compatibility_handler";
import { convertResponsesRequest, invalidRequest } from "./request";
import { convertJsonResponse } from "./response";
import { convertStreamingResponse } from "./stream";

const protocol = {
  endpoint: "responses" as const,
  invalidRequest,
  convertRequest: convertResponsesRequest,
  convertJsonResponse,
  convertStreamingResponse,
};

export function handleResponsesRequest(
  context: RoutedRequestContext,
  aiGateway: CloudflareAIGateway | undefined = undefined,
): Promise<Response> {
  return handleCompatibilityRequest(context, aiGateway, protocol);
}
