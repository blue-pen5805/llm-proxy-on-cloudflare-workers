import { readResponseJson } from "../../utils/helpers";
import { openAIErrorResponse } from "../error_response";
import { headersForRewrittenBody } from "../response";
import { isJsonObject as isObject, type JsonObject } from "../sse";
import {
  type ChatUsage,
  type ResponseProfile,
  type ResponsesRequest,
  textValue,
} from "./request";

const MAX_CONVERTED_RESPONSE_BYTES = 5 * 1024 * 1024;

export function profileFor(request: ResponsesRequest): ResponseProfile {
  const reasoning = isObject(request.reasoning) ? request.reasoning : {};
  const text = isObject(request.text) ? request.text : {};
  return {
    instructions: textValue(request.instructions) ?? null,
    maxOutputTokens:
      typeof request.max_output_tokens === "number"
        ? request.max_output_tokens
        : null,
    metadata: isObject(request.metadata) ? request.metadata : {},
    model: request.model,
    parallelToolCalls:
      typeof request.parallel_tool_calls === "boolean"
        ? request.parallel_tool_calls
        : true,
    reasoningEffort: textValue(reasoning.effort) ?? null,
    serviceTier: textValue(request.service_tier) ?? null,
    store: typeof request.store === "boolean" ? request.store : false,
    temperature:
      typeof request.temperature === "number" ? request.temperature : null,
    text,
    toolChoice: request.tool_choice ?? "auto",
    tools: Array.isArray(request.tools) ? request.tools : [],
    topP: typeof request.top_p === "number" ? request.top_p : null,
    truncation: "disabled",
    user: textValue(request.user) ?? null,
  };
}

export function responseId(): string {
  return `resp_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function itemId(prefix: "msg" | "fc" | "ctc"): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function convertUsage(usage: unknown): JsonObject | null {
  if (!isObject(usage)) return null;
  const typed = usage as ChatUsage;
  const inputTokens =
    typeof typed.prompt_tokens === "number" ? typed.prompt_tokens : 0;
  const outputTokens =
    typeof typed.completion_tokens === "number" ? typed.completion_tokens : 0;
  return {
    input_tokens: inputTokens,
    input_tokens_details: isObject(typed.prompt_tokens_details)
      ? typed.prompt_tokens_details
      : { cached_tokens: 0 },
    output_tokens: outputTokens,
    output_tokens_details: isObject(typed.completion_tokens_details)
      ? typed.completion_tokens_details
      : { reasoning_tokens: 0 },
    total_tokens:
      typeof typed.total_tokens === "number"
        ? typed.total_tokens
        : inputTokens + outputTokens,
  };
}

function tokenBytes(value: unknown, token: string): number[] {
  return Array.isArray(value) && value.every((byte) => typeof byte === "number")
    ? value
    : [...new TextEncoder().encode(token)];
}

function convertTopLogprobs(
  value: unknown,
  includeBytes: boolean,
): JsonObject[] {
  if (!Array.isArray(value)) return [];
  const converted: JsonObject[] = [];
  for (const item of value) {
    if (
      !isObject(item) ||
      typeof item.token !== "string" ||
      typeof item.logprob !== "number"
    ) {
      continue;
    }
    converted.push({
      token: item.token,
      ...(includeBytes ? { bytes: tokenBytes(item.bytes, item.token) } : {}),
      logprob: item.logprob,
    });
  }
  return converted;
}

export function convertTokenLogprobs(
  value: unknown,
  includeBytes: boolean,
): JsonObject[] {
  if (!isObject(value) || !Array.isArray(value.content)) return [];
  const converted: JsonObject[] = [];
  for (const item of value.content) {
    if (
      !isObject(item) ||
      typeof item.token !== "string" ||
      typeof item.logprob !== "number"
    ) {
      continue;
    }
    converted.push({
      token: item.token,
      ...(includeBytes ? { bytes: tokenBytes(item.bytes, item.token) } : {}),
      logprob: item.logprob,
      top_logprobs: convertTopLogprobs(item.top_logprobs, includeBytes),
    });
  }
  return converted;
}

export function baseResponse(
  id: string,
  createdAt: number,
  status: "in_progress" | "completed" | "incomplete",
  profile: ResponseProfile,
  output: unknown[],
  usage: JsonObject | null,
  proxyMetadata: JsonObject | undefined,
): JsonObject {
  return {
    id,
    object: "response",
    created_at: createdAt,
    status,
    background: false,
    completed_at: status === "completed" ? Math.floor(Date.now() / 1000) : null,
    error: null,
    incomplete_details:
      status === "incomplete" ? { reason: "max_output_tokens" } : null,
    instructions: profile.instructions,
    max_output_tokens: profile.maxOutputTokens,
    model: profile.model,
    output,
    parallel_tool_calls: profile.parallelToolCalls,
    previous_response_id: null,
    reasoning: { effort: profile.reasoningEffort, summary: null },
    service_tier: profile.serviceTier,
    store: profile.store,
    temperature: profile.temperature,
    text: profile.text,
    tool_choice: profile.toolChoice,
    tools: profile.tools,
    top_p: profile.topP,
    truncation: profile.truncation,
    usage,
    user: profile.user,
    metadata: profile.metadata,
    ...(proxyMetadata === undefined ? {} : { llm_proxy: proxyMetadata }),
  };
}

function convertChatOutput(message: JsonObject, logprobs: unknown): unknown[] {
  const output: unknown[] = [];
  const content = typeof message.content === "string" ? message.content : "";
  const refusal = typeof message.refusal === "string" ? message.refusal : "";
  if (content || refusal || !Array.isArray(message.tool_calls)) {
    output.push({
      id: itemId("msg"),
      type: "message",
      status: "completed",
      role: "assistant",
      content: [
        ...(content
          ? [
              {
                type: "output_text",
                text: content,
                annotations: [],
                logprobs: convertTokenLogprobs(logprobs, true),
              },
            ]
          : []),
        ...(refusal ? [{ type: "refusal", refusal }] : []),
      ],
    });
  }
  if (Array.isArray(message.tool_calls)) {
    for (const call of message.tool_calls) {
      if (!isObject(call)) continue;
      if (call.type === "custom" && isObject(call.custom)) {
        output.push({
          id: itemId("ctc"),
          type: "custom_tool_call",
          status: "completed",
          call_id: textValue(call.id) ?? itemId("ctc"),
          name: textValue(call.custom.name) ?? "",
          input: textValue(call.custom.input) ?? "",
        });
      } else if (isObject(call.function)) {
        output.push({
          id: itemId("fc"),
          type: "function_call",
          status: "completed",
          call_id: textValue(call.id) ?? itemId("fc"),
          name: textValue(call.function.name) ?? "",
          arguments: textValue(call.function.arguments) ?? "",
        });
      }
    }
  }
  return output;
}

export async function convertJsonResponse(
  response: Response,
  request: ResponsesRequest,
  responseMetadataEnabled: boolean,
): Promise<Response> {
  let body: unknown;
  try {
    body = await readResponseJson(response, MAX_CONVERTED_RESPONSE_BYTES);
  } catch {
    return invalidUpstreamResponse();
  }
  if (!isObject(body) || !Array.isArray(body.choices)) {
    return invalidUpstreamResponse();
  }
  const choice = body.choices.find(isObject);
  const message = choice && isObject(choice.message) ? choice.message : {};
  const status =
    choice?.finish_reason === "length" ? "incomplete" : "completed";
  const createdAt =
    typeof body.created === "number"
      ? body.created
      : Math.floor(Date.now() / 1000);
  const converted = baseResponse(
    responseId(),
    createdAt,
    status,
    profileFor(request),
    convertChatOutput(message, choice?.logprobs),
    convertUsage(body.usage),
    responseMetadataEnabled && isObject(body.llm_proxy)
      ? body.llm_proxy
      : undefined,
  );
  return new Response(JSON.stringify(converted), {
    status: response.status,
    statusText: response.statusText,
    headers: headersForRewrittenBody(response.headers),
  });
}

export function invalidUpstreamResponse(): Response {
  return openAIErrorResponse(
    "Upstream returned an invalid Chat Completions response.",
    502,
  );
}

/** Translate OpenAI Responses requests onto the existing Chat Completions flow. */
