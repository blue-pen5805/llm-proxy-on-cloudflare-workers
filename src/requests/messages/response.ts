import { readResponseJson } from "../../utils/helpers";
import { headersForRewrittenBody } from "../response";
import { isJsonObject as isObject, type JsonObject } from "../sse";
import type { MessagesRequest } from "./request";

const MAX_CONVERTED_RESPONSE_BYTES = 5 * 1024 * 1024;

export function messageId(): string {
  return `msg_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function stopReason(reason: unknown): string {
  if (reason === "length") return "max_tokens";
  if (reason === "tool_calls" || reason === "function_call") return "tool_use";
  if (reason === "content_filter") return "refusal";
  return "end_turn";
}

export function convertUsage(usage: unknown): JsonObject {
  const typed = isObject(usage) ? usage : {};
  const promptDetails = isObject(typed.prompt_tokens_details)
    ? typed.prompt_tokens_details
    : {};
  return {
    input_tokens:
      typeof typed.prompt_tokens === "number" ? typed.prompt_tokens : 0,
    output_tokens:
      typeof typed.completion_tokens === "number" ? typed.completion_tokens : 0,
    ...(typeof promptDetails.cached_tokens === "number"
      ? { cache_read_input_tokens: promptDetails.cached_tokens }
      : {}),
  };
}

function convertContent(message: JsonObject): JsonObject[] {
  const content: JsonObject[] = [];
  if (typeof message.content === "string" && message.content) {
    content.push({ type: "text", text: message.content });
  }
  if (typeof message.refusal === "string" && message.refusal) {
    content.push({ type: "text", text: message.refusal });
  }
  if (Array.isArray(message.tool_calls)) {
    for (const call of message.tool_calls) {
      if (!isObject(call) || !isObject(call.function)) continue;
      let input: unknown = {};
      if (typeof call.function.arguments === "string") {
        try {
          input = JSON.parse(call.function.arguments) as unknown;
        } catch {
          input = {};
        }
      }
      content.push({
        type: "tool_use",
        id:
          typeof call.id === "string"
            ? call.id
            : `toolu_${crypto.randomUUID()}`,
        name: typeof call.function.name === "string" ? call.function.name : "",
        input,
      });
    }
  }
  return content;
}

export function invalidUpstreamResponse(): Response {
  return Response.json(
    {
      type: "error",
      error: {
        type: "api_error",
        message: "Upstream returned an invalid Chat Completions response.",
      },
    },
    { status: 502 },
  );
}

export async function convertJsonResponse(
  response: Response,
  request: MessagesRequest,
  responseMetadataEnabled: boolean,
): Promise<Response> {
  let body: unknown;
  try {
    body = await readResponseJson(response, MAX_CONVERTED_RESPONSE_BYTES);
  } catch {
    return invalidUpstreamResponse();
  }
  if (!isObject(body) || !Array.isArray(body.choices))
    return invalidUpstreamResponse();
  const choice = body.choices.find(isObject);
  const message = choice && isObject(choice.message) ? choice.message : {};
  const converted = {
    id: messageId(),
    type: "message",
    role: "assistant",
    content: convertContent(message),
    model: request.model,
    stop_reason: stopReason(choice?.finish_reason),
    stop_sequence: null,
    usage: convertUsage(body.usage),
    ...(responseMetadataEnabled && isObject(body.llm_proxy)
      ? { llm_proxy: body.llm_proxy }
      : {}),
  };
  return new Response(JSON.stringify(converted), {
    status: response.status,
    statusText: response.statusText,
    headers: headersForRewrittenBody(response.headers),
  });
}
