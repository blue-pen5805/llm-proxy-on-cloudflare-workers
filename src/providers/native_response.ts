import { isJsonObject, type JsonObject } from "../requests/sse";
import type { NativeProtocol } from "./native_request";

export function nativeObject(value: unknown): JsonObject {
  if (!isJsonObject(value))
    throw new Error("Invalid native inference response object.");
  return value;
}

export function nativeObjects(value: unknown): JsonObject[] {
  if (!Array.isArray(value))
    throw new Error("Invalid native inference response array.");
  return value.map(nativeObject);
}

export function nativeUsage(
  data: JsonObject,
  protocol: NativeProtocol,
): JsonObject {
  let input: number;
  let output: number;
  let cached: number;
  if (protocol === "messages") {
    cached = Number(data.cache_read_input_tokens ?? 0);
    input =
      Number(data.input_tokens ?? 0) +
      cached +
      Number(data.cache_creation_input_tokens ?? 0);
    output = Number(data.output_tokens ?? 0);
  } else if (protocol === "converse") {
    cached = Number(data.cacheReadInputTokens ?? 0);
    input =
      Number(data.inputTokens ?? 0) +
      cached +
      Number(data.cacheWriteInputTokens ?? 0);
    output = Number(data.outputTokens ?? 0);
  } else {
    cached = Number(data.cachedContentTokenCount ?? 0);
    input = Number(data.promptTokenCount ?? 0);
    output =
      Number(data.candidatesTokenCount ?? 0) +
      Number(data.thoughtsTokenCount ?? 0);
  }
  return {
    prompt_tokens: input,
    completion_tokens: output,
    total_tokens: input + output,
    prompt_tokens_details: { cached_tokens: cached },
  };
}

export function nativeFinishReason(reason: unknown): string {
  if (reason === "max_tokens" || reason === "MAX_TOKENS") return "length";
  if (reason === "tool_use") return "tool_calls";
  if (
    reason === "SAFETY" ||
    reason === "RECITATION" ||
    reason === "refusal" ||
    reason === "guardrail_intervened" ||
    reason === "content_filtered"
  )
    return "content_filter";
  return "stop";
}

export function nativeMessage(
  parts: JsonObject[],
  protocol: NativeProtocol,
): JsonObject {
  const calls: JsonObject[] = [];
  let text = "";
  for (const part of parts) {
    if (typeof part.text === "string" && !part.thought) text += part.text;
    const fn =
      protocol === "messages"
        ? part.type === "tool_use"
          ? part
          : undefined
        : protocol === "converse"
          ? part.toolUse
          : part.functionCall;
    if (isJsonObject(fn)) {
      calls.push({
        id: fn.id ?? fn.toolUseId ?? `call_${crypto.randomUUID()}`,
        type: "function",
        function: {
          name: fn.name,
          arguments: JSON.stringify(
            protocol === "generateContent" ? (fn.args ?? {}) : (fn.input ?? {}),
          ),
        },
        ...(typeof part.thoughtSignature === "string"
          ? {
              extra_content: {
                google: { thought_signature: part.thoughtSignature },
              },
            }
          : {}),
      });
    }
  }
  return {
    role: "assistant",
    content: text || null,
    ...(calls.length ? { tool_calls: calls } : {}),
  };
}

export function convertNativeJson(
  body: JsonObject,
  protocol: NativeProtocol,
  model: string,
): JsonObject {
  let choices: JsonObject[];
  let tokens: unknown;
  if (protocol === "messages") {
    choices = [
      {
        index: 0,
        message: nativeMessage(nativeObjects(body.content), protocol),
        finish_reason: nativeFinishReason(body.stop_reason),
      },
    ];
    tokens = body.usage;
  } else if (protocol === "converse") {
    choices = [
      {
        index: 0,
        message: nativeMessage(
          nativeObjects(
            nativeObject(nativeObject(body.output).message).content,
          ),
          protocol,
        ),
        finish_reason: nativeFinishReason(body.stopReason),
      },
    ];
    tokens = body.usage;
  } else {
    const feedback = isJsonObject(body.promptFeedback)
      ? body.promptFeedback
      : {};
    choices = feedback.blockReason
      ? [
          {
            index: 0,
            message: { role: "assistant", content: null },
            finish_reason: "content_filter",
          },
        ]
      : nativeObjects(body.candidates).map((candidate, index) => {
          const message = nativeMessage(
            nativeObjects(
              nativeObject(candidate.content ?? { parts: [] }).parts,
            ),
            protocol,
          );
          return {
            index: candidate.index ?? index,
            message,
            finish_reason: message.tool_calls
              ? "tool_calls"
              : nativeFinishReason(candidate.finishReason),
          };
        });
    tokens = body.usageMetadata;
  }
  return {
    id: body.id ?? body.responseId ?? `chatcmpl_${crypto.randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices,
    usage: nativeUsage(nativeObject(tokens ?? {}), protocol),
  };
}
