import { isJsonObject, type JsonObject } from "../requests/sse";
import { unsupportedNativeField } from "./native_request";

const COPIED_FIELDS = [
  "model",
  "stream",
  "temperature",
  "top_p",
  "parallel_tool_calls",
  "store",
  "metadata",
  "user",
  "service_tier",
  "prompt_cache_key",
  "prompt_cache_retention",
  "safety_identifier",
] as const;
const SUPPORTED_FIELDS = new Set<string>([
  ...COPIED_FIELDS,
  "messages",
  "max_tokens",
  "max_completion_tokens",
  "stream_options",
  "tools",
  "tool_choice",
  "response_format",
  "reasoning_effort",
  "verbosity",
  "n",
]);

function object(value: unknown): JsonObject {
  if (!isJsonObject(value)) return unsupportedNativeField("Responses object");
  return value;
}

function objects(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) return unsupportedNativeField("Responses array");
  return value.map(object);
}

function text(value: unknown): string {
  if (typeof value !== "string")
    return unsupportedNativeField("Responses text");
  return value;
}

function content(value: unknown, assistant: boolean): JsonObject[] {
  if (value == null) return [];
  const parts =
    typeof value === "string"
      ? [{ type: "text", text: value }]
      : objects(value);
  return parts.map((part) => {
    if (part.type === "text") {
      return {
        type: assistant ? "output_text" : "input_text",
        text: text(part.text),
      };
    }
    if (part.type === "image_url" && !assistant) {
      const image = object(part.image_url);
      const url = text(image.url);
      if (
        !/^(?:https?:\/\/|data:image\/(?:png|jpeg|webp|gif);base64,)/.test(url)
      ) {
        return unsupportedNativeField("image_url");
      }
      return {
        type: "input_image",
        image_url: url,
        ...(image.detail === undefined ? {} : { detail: image.detail }),
      };
    }
    return unsupportedNativeField("messages.content");
  });
}

/** Stateless Chat history maps to ordered Responses input items. */
export function prepareResponsesRequest(
  data: JsonObject & { model: string },
): JsonObject {
  for (const field of Object.keys(data)) {
    if (!SUPPORTED_FIELDS.has(field)) unsupportedNativeField(field);
  }
  if (data.n !== undefined && data.n !== 1) unsupportedNativeField("n");
  const input: JsonObject[] = [];
  for (const message of objects(data.messages)) {
    if (message.function_call !== undefined || message.name !== undefined) {
      unsupportedNativeField("named or legacy function messages");
    }
    if (message.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: text(message.tool_call_id),
        output: text(message.content),
      });
      continue;
    }
    if (
      !["system", "developer", "user", "assistant"].includes(text(message.role))
    ) {
      unsupportedNativeField("messages.role");
    }
    const assistant = message.role === "assistant";
    const parts = content(message.content, assistant);
    if (message.refusal !== undefined && message.refusal !== null) {
      if (!assistant) unsupportedNativeField("messages.refusal");
      parts.push({ type: "refusal", refusal: text(message.refusal) });
    }
    if (parts.length) input.push({ role: message.role, content: parts });
    if (message.tool_calls !== undefined) {
      if (!assistant) unsupportedNativeField("messages.tool_calls");
      for (const call of objects(message.tool_calls)) {
        if (call.type !== "function") unsupportedNativeField("tool_calls.type");
        const fn = object(call.function);
        input.push({
          type: "function_call",
          call_id: text(call.id),
          name: text(fn.name),
          arguments: text(fn.arguments),
        });
      }
    }
  }
  // Chat requests are stateless unless storage is explicitly requested.
  const result: JsonObject = { input, store: false };
  for (const field of COPIED_FIELDS) {
    if (data[field] !== undefined) result[field] = data[field];
  }
  const maxTokens = data.max_completion_tokens ?? data.max_tokens;
  if (maxTokens !== undefined) result.max_output_tokens = maxTokens;
  if (data.reasoning_effort !== undefined)
    result.reasoning = { effort: data.reasoning_effort };
  if (data.tools !== undefined) {
    result.tools = objects(data.tools).map((tool) => {
      if (tool.type !== "function") return unsupportedNativeField("tools.type");
      const fn = object(tool.function);
      // Responses defaults strict to true; Chat function tools do not.
      return {
        ...fn,
        type: "function",
        name: text(fn.name),
        strict: fn.strict ?? false,
      };
    });
  }
  if (data.tool_choice !== undefined) {
    if (typeof data.tool_choice === "string")
      result.tool_choice = data.tool_choice;
    else {
      const choice = object(data.tool_choice);
      if (choice.type !== "function") unsupportedNativeField("tool_choice");
      result.tool_choice = {
        type: "function",
        name: text(object(choice.function).name),
      };
    }
  }
  const textOptions: JsonObject = {};
  if (data.verbosity !== undefined) textOptions.verbosity = data.verbosity;
  if (data.response_format !== undefined) {
    const format = object(data.response_format);
    if (format.type === "json_schema") {
      textOptions.format = {
        ...object(format.json_schema),
        type: "json_schema",
      };
    } else if (format.type === "text" || format.type === "json_object") {
      textOptions.format = { type: format.type };
    } else unsupportedNativeField("response_format");
  }
  if (Object.keys(textOptions).length) result.text = textOptions;
  return result;
}
