import { isJsonObject, type JsonObject } from "../requests/sse";
import { nativeObject, nativeObjects } from "./native_response";

export function responsesUsage(value: unknown): JsonObject {
  const usage = isJsonObject(value) ? value : {};
  const input = Number(usage.input_tokens ?? 0);
  const output = Number(usage.output_tokens ?? 0);
  return {
    prompt_tokens: input,
    completion_tokens: output,
    total_tokens: input + output,
    ...(isJsonObject(usage.input_tokens_details)
      ? { prompt_tokens_details: usage.input_tokens_details }
      : {}),
    ...(isJsonObject(usage.output_tokens_details)
      ? { completion_tokens_details: usage.output_tokens_details }
      : {}),
  };
}

export function responsesFinishReason(
  body: JsonObject,
  hasTools: boolean,
): string {
  if (body.status === "incomplete") {
    const reason = nativeObject(body.incomplete_details).reason;
    if (reason === "max_output_tokens") return "length";
    if (reason === "content_filter") return "content_filter";
    throw new Error("Unknown Responses incomplete reason.");
  }
  if (body.status !== "completed" || body.error)
    throw new Error("Responses inference did not complete.");
  return hasTools ? "tool_calls" : "stop";
}

export function responsesText(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid Responses text.");
  return value;
}

export function convertResponsesJson(
  body: JsonObject,
  model: string,
): JsonObject {
  let content = "";
  let refusal = "";
  const calls: JsonObject[] = [];
  for (const item of nativeObjects(body.output)) {
    if (item.type === "message") {
      for (const part of nativeObjects(item.content)) {
        if (part.type === "output_text") content += responsesText(part.text);
        else if (part.type === "refusal")
          refusal += responsesText(part.refusal);
        else throw new Error("Unsupported Responses content.");
      }
    } else if (item.type === "function_call") {
      calls.push({
        id: responsesText(item.call_id),
        type: "function",
        function: {
          name: responsesText(item.name),
          arguments: responsesText(item.arguments),
        },
      });
    } else if (item.type !== "reasoning")
      throw new Error("Unsupported Responses output item.");
  }
  return {
    id: body.id ?? `chatcmpl_${crypto.randomUUID()}`,
    object: "chat.completion",
    created: body.created_at ?? Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: content || null,
          ...(refusal ? { refusal } : {}),
          ...(calls.length ? { tool_calls: calls } : {}),
        },
        finish_reason: responsesFinishReason(body, calls.length > 0),
      },
    ],
    usage: responsesUsage(body.usage),
  };
}
