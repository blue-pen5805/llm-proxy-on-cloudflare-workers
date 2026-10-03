import type { JsonObject } from "./sse";

/** Consecutive assistant items represent one turn until a tool or other role. */
export function appendChatHistory(
  messages: JsonObject[],
  message: JsonObject,
): void {
  const previous = messages.at(-1);
  if (message.role !== "assistant" || previous?.role !== "assistant") {
    messages.push(message);
    return;
  }
  if (message.content !== null) {
    const parts = (content: unknown): unknown[] =>
      content === null
        ? []
        : typeof content === "string"
          ? [{ type: "text", text: content }]
          : (content as unknown[]);
    const content = parts(previous.content);
    for (const part of parts(message.content)) content.push(part);
    previous.content = content;
  }
  if (Array.isArray(message.tool_calls)) {
    if (Array.isArray(previous.tool_calls)) {
      for (const call of message.tool_calls) previous.tool_calls.push(call);
    } else {
      previous.tool_calls = message.tool_calls;
    }
  }
}
