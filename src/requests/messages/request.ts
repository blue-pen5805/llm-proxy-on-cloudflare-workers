import { anthropicErrorResponse } from "../error_response";
import { isJsonObject as isObject, type JsonObject } from "../sse";

const SUPPORTED_REQUEST_FIELDS = new Set([
  "max_tokens",
  "messages",
  "metadata",
  "model",
  "stop_sequences",
  "stream",
  "system",
  "temperature",
  "tool_choice",
  "tools",
  "top_p",
]);

export interface MessagesRequest extends JsonObject {
  max_tokens: number;
  messages: unknown[];
  model: string;
}

export function invalidRequest(message: string): Response {
  return anthropicErrorResponse(message, 400);
}

function unsupported(field: string): never {
  throw new Error(`Messages field is not supported: ${field}.`);
}

function requireOnly(
  value: JsonObject,
  allowed: readonly string[],
  field: string,
) {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) unsupported(`${field}.${unknown}`);
}

function convertImageSource(source: unknown): string {
  if (!isObject(source) || typeof source.type !== "string") {
    return unsupported("messages.content.image.source");
  }
  if (
    source.type === "base64" &&
    typeof source.media_type === "string" &&
    typeof source.data === "string"
  ) {
    requireOnly(
      source,
      ["type", "media_type", "data"],
      "messages.content.image.source",
    );
    return `data:${source.media_type};base64,${source.data}`;
  }
  if (source.type === "url" && typeof source.url === "string") {
    requireOnly(source, ["type", "url"], "messages.content.image.source");
    return source.url;
  }
  return unsupported("messages.content.image.source");
}

function convertOrdinaryBlock(block: JsonObject): JsonObject {
  if (block.type === "text" && typeof block.text === "string") {
    requireOnly(block, ["type", "text"], "messages.content.text");
    return { type: "text", text: block.text };
  }
  if (block.type === "image") {
    requireOnly(block, ["type", "source"], "messages.content.image");
    return {
      type: "image_url",
      image_url: { url: convertImageSource(block.source) },
    };
  }
  return unsupported(`messages.content.${block.type}`);
}

function toolResultContent(content: unknown): string | JsonObject[] {
  if (typeof content === "string") return content;
  if (!Array.isArray(content))
    return unsupported("messages.content.tool_result.content");
  return content.map((block) => {
    if (
      !isObject(block) ||
      block.type !== "text" ||
      typeof block.text !== "string"
    ) {
      return unsupported("messages.content.tool_result.content");
    }
    requireOnly(
      block,
      ["type", "text"],
      "messages.content.tool_result.content",
    );
    return { type: "text", text: block.text };
  });
}

function convertMessage(message: unknown): JsonObject[] {
  if (
    !isObject(message) ||
    !["user", "assistant"].includes(String(message.role))
  ) {
    return unsupported("messages");
  }
  requireOnly(message, ["role", "content"], "messages[]");
  const role = message.role as "user" | "assistant";
  if (typeof message.content === "string") {
    return [{ role, content: message.content }];
  }
  if (!Array.isArray(message.content)) return unsupported("messages.content");

  const converted: JsonObject[] = [];
  let ordinary: JsonObject[] = [];
  const flushOrdinary = () => {
    if (ordinary.length > 0) {
      converted.push({ role, content: ordinary });
      ordinary = [];
    }
  };

  for (const block of message.content) {
    if (!isObject(block) || typeof block.type !== "string") {
      unsupported("messages.content");
    }
    if (block.type === "tool_result") {
      if (role !== "user" || typeof block.tool_use_id !== "string") {
        unsupported("messages.content.tool_result");
      }
      requireOnly(
        block,
        ["type", "tool_use_id", "content"],
        "messages.content.tool_result",
      );
      flushOrdinary();
      converted.push({
        role: "tool",
        tool_call_id: block.tool_use_id,
        content: toolResultContent(block.content),
      });
      continue;
    }
    if (block.type === "tool_use") {
      if (
        role !== "assistant" ||
        typeof block.id !== "string" ||
        typeof block.name !== "string" ||
        !isObject(block.input)
      ) {
        unsupported("messages.content.tool_use");
      }
      requireOnly(
        block,
        ["type", "id", "name", "input"],
        "messages.content.tool_use",
      );
      flushOrdinary();
      converted.push({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: block.id,
            type: "function",
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input),
            },
          },
        ],
      });
      continue;
    }
    ordinary.push(convertOrdinaryBlock(block));
  }
  flushOrdinary();
  return converted.length > 0 ? converted : [{ role, content: [] }];
}

function convertSystem(system: unknown): JsonObject | undefined {
  if (system === undefined) return undefined;
  if (typeof system === "string") return { role: "system", content: system };
  if (!Array.isArray(system)) return unsupported("system");
  return {
    role: "system",
    content: system.map((block) => {
      if (
        !isObject(block) ||
        block.type !== "text" ||
        typeof block.text !== "string"
      ) {
        return unsupported("system");
      }
      requireOnly(block, ["type", "text"], "system");
      return { type: "text", text: block.text };
    }),
  };
}

function convertTools(tools: unknown): JsonObject[] | undefined {
  if (tools === undefined) return undefined;
  if (!Array.isArray(tools)) return unsupported("tools");
  return tools.map((tool) => {
    if (
      !isObject(tool) ||
      typeof tool.name !== "string" ||
      !isObject(tool.input_schema)
    ) {
      return unsupported("tools");
    }
    requireOnly(tool, ["name", "description", "input_schema"], "tools[]");
    return {
      type: "function",
      function: {
        name: tool.name,
        ...(typeof tool.description === "string"
          ? { description: tool.description }
          : {}),
        parameters: tool.input_schema,
      },
    };
  });
}

function convertToolChoice(choice: unknown):
  | {
      toolChoice: unknown;
      parallelToolCalls?: boolean;
    }
  | undefined {
  if (choice === undefined) return undefined;
  if (!isObject(choice) || typeof choice.type !== "string") {
    return unsupported("tool_choice");
  }
  requireOnly(
    choice,
    ["type", "name", "disable_parallel_tool_use"],
    "tool_choice",
  );
  let toolChoice: unknown;
  if (choice.type === "auto" || choice.type === "none")
    toolChoice = choice.type;
  else if (choice.type === "any") toolChoice = "required";
  else if (choice.type === "tool" && typeof choice.name === "string") {
    toolChoice = { type: "function", function: { name: choice.name } };
  } else return unsupported("tool_choice");
  if (
    choice.disable_parallel_tool_use !== undefined &&
    typeof choice.disable_parallel_tool_use !== "boolean"
  ) {
    return unsupported("tool_choice.disable_parallel_tool_use");
  }
  return {
    toolChoice,
    ...(typeof choice.disable_parallel_tool_use === "boolean"
      ? { parallelToolCalls: !choice.disable_parallel_tool_use }
      : {}),
  };
}

export function convertMessagesRequest(body: unknown): {
  chat: JsonObject & { model: string };
  request: MessagesRequest;
} {
  if (
    !isObject(body) ||
    typeof body.model !== "string" ||
    !Array.isArray(body.messages) ||
    typeof body.max_tokens !== "number"
  ) {
    throw new Error("Invalid request.");
  }
  for (const field of Object.keys(body)) {
    if (!SUPPORTED_REQUEST_FIELDS.has(field)) unsupported(field);
  }
  if (body.metadata !== undefined) {
    if (!isObject(body.metadata)) unsupported("metadata");
    requireOnly(body.metadata, ["user_id"], "metadata");
    if (
      body.metadata.user_id !== undefined &&
      typeof body.metadata.user_id !== "string"
    ) {
      unsupported("metadata.user_id");
    }
  }
  if (
    body.stop_sequences !== undefined &&
    !Array.isArray(body.stop_sequences)
  ) {
    unsupported("stop_sequences");
  }
  const system = convertSystem(body.system);
  const tools = convertTools(body.tools);
  const choice = convertToolChoice(body.tool_choice);
  const messages: JsonObject[] = [];
  if (system) messages.push(system);
  for (const message of body.messages) {
    messages.push(...convertMessage(message));
  }
  return {
    request: body as MessagesRequest,
    chat: {
      model: body.model,
      messages,
      max_completion_tokens: body.max_tokens,
      ...(body.stream === undefined ? {} : { stream: body.stream }),
      ...(body.stream === true
        ? { stream_options: { include_usage: true } }
        : {}),
      ...(body.stop_sequences === undefined
        ? {}
        : { stop: body.stop_sequences }),
      ...(body.temperature === undefined
        ? {}
        : { temperature: body.temperature }),
      ...(body.top_p === undefined ? {} : { top_p: body.top_p }),
      ...(isObject(body.metadata) && typeof body.metadata.user_id === "string"
        ? { user: body.metadata.user_id }
        : {}),
      ...(tools === undefined ? {} : { tools }),
      ...(choice === undefined
        ? {}
        : {
            tool_choice: choice.toolChoice,
            ...(choice.parallelToolCalls === undefined
              ? {}
              : { parallel_tool_calls: choice.parallelToolCalls }),
          }),
    },
  };
}
