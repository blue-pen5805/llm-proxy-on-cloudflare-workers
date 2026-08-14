import { anthropicErrorResponse } from "../error_response";
import { isJsonObject as isObject, type JsonObject } from "../sse";
import type { MessagesRequest } from "./types";

export type { MessagesRequest } from "./types";

/** Top-level Messages fields with an implemented Chat Completions conversion. */
export const SUPPORTED_REQUEST_FIELDS: ReadonlySet<keyof MessagesRequest> =
  new Set<keyof MessagesRequest>([
    "max_tokens",
    "messages",
    "metadata",
    "model",
    "output_config",
    "stop_sequences",
    "stream",
    "system",
    "temperature",
    "tool_choice",
    "tools",
    "top_p",
  ]);

function selectSupportedRequestFields<T extends JsonObject>(body: T): T {
  const selected: JsonObject = {};
  for (const field of SUPPORTED_REQUEST_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      selected[field] = body[field];
    }
  }
  return selected as T;
}

export function invalidRequest(message: string): Response {
  return anthropicErrorResponse(message, 400);
}

function unsupported(field: string): never {
  throw new Error(`Messages field is not supported: ${field}.`);
}

function convertImageSource(source: unknown): string | undefined {
  if (!isObject(source) || typeof source.type !== "string") {
    return unsupported("messages.content.image.source");
  }
  if (
    source.type === "base64" &&
    typeof source.media_type === "string" &&
    typeof source.data === "string"
  ) {
    return `data:${source.media_type};base64,${source.data}`;
  }
  if (source.type === "url" && typeof source.url === "string") {
    return source.url;
  }
  return undefined;
}

function convertOrdinaryBlock(block: JsonObject): JsonObject | undefined {
  if (block.type === "text" && typeof block.text === "string") {
    return { type: "text", text: block.text };
  }
  if (block.type === "image") {
    const url = convertImageSource(block.source);
    if (url === undefined) return undefined;
    return {
      type: "image_url",
      image_url: { url },
    };
  }
  return undefined;
}

function toolResultContent(content: unknown): string | JsonObject[] {
  if (content === undefined) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content))
    return unsupported("messages.content.tool_result.content");
  return content.flatMap((block) => {
    if (
      !isObject(block) ||
      block.type !== "text" ||
      typeof block.text !== "string"
    ) {
      return [];
    }
    return [{ type: "text", text: block.text }];
  });
}

function convertMidConversationSystem(
  block: JsonObject,
): JsonObject & { content: JsonObject[] } {
  if (!Array.isArray(block.content)) {
    unsupported("messages.content.system.content");
  }
  const content = block.content.flatMap((nested) => {
    if (
      !isObject(nested) ||
      nested.type !== "text" ||
      typeof nested.text !== "string"
    ) {
      return [];
    }
    return [{ type: "text", text: nested.text }];
  });
  return { role: "system", content };
}

function convertMessage(message: unknown): JsonObject[] {
  if (!isObject(message)) return unsupported("messages");
  if (!["user", "assistant", "system"].includes(String(message.role))) {
    return [];
  }
  const role = message.role as "user" | "assistant" | "system";
  if (typeof message.content === "string") {
    return [{ role, content: message.content }];
  }
  if (!Array.isArray(message.content)) return unsupported("messages.content");

  if (role === "system") {
    const content: JsonObject[] = [];
    for (const block of message.content) {
      if (!isObject(block) || typeof block.type !== "string") {
        continue;
      }
      if (block.type === "mid_conv_system") {
        content.push(...convertMidConversationSystem(block).content);
        continue;
      }
      if (block.type !== "text" || typeof block.text !== "string") {
        continue;
      }
      content.push({ type: "text", text: block.text });
    }
    return [
      {
        role,
        content,
      },
    ];
  }

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
    if (block.type === "mid_conv_system") {
      flushOrdinary();
      converted.push(convertMidConversationSystem(block));
      continue;
    }
    if (block.type === "tool_result") {
      if (role !== "user" || typeof block.tool_use_id !== "string") {
        unsupported("messages.content.tool_result");
      }
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
    const ordinaryBlock = convertOrdinaryBlock(block);
    if (ordinaryBlock) ordinary.push(ordinaryBlock);
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
    content: system.flatMap((block) => {
      if (
        !isObject(block) ||
        block.type !== "text" ||
        typeof block.text !== "string"
      ) {
        return [];
      }
      return [{ type: "text", text: block.text }];
    }),
  };
}

function convertTools(tools: unknown): JsonObject[] | undefined {
  if (tools === undefined) return undefined;
  if (!Array.isArray(tools)) return unsupported("tools");
  return tools.flatMap((tool): JsonObject[] => {
    if (
      !isObject(tool) ||
      typeof tool.name !== "string" ||
      !isObject(tool.input_schema)
    ) {
      return [];
    }
    if (
      tool.type !== undefined &&
      tool.type !== null &&
      tool.type !== "custom"
    ) {
      return [];
    }
    return [
      {
        type: "function",
        function: {
          name: tool.name,
          ...(typeof tool.description === "string"
            ? { description: tool.description }
            : {}),
          parameters: tool.input_schema,
          ...(typeof tool.strict === "boolean" ? { strict: tool.strict } : {}),
        },
      },
    ];
  });
}

function convertOutputConfig(outputConfig: unknown): JsonObject {
  if (outputConfig === undefined) return {};
  if (!isObject(outputConfig)) return unsupported("output_config");

  const converted: JsonObject = {};
  if (typeof outputConfig.effort === "string") {
    converted.reasoning_effort = outputConfig.effort;
  }
  if (outputConfig.format !== undefined && outputConfig.format !== null) {
    if (
      !isObject(outputConfig.format) ||
      outputConfig.format.type !== "json_schema" ||
      !isObject(outputConfig.format.schema)
    ) {
      return converted;
    }
    converted.response_format = {
      type: "json_schema",
      json_schema: {
        name: "response",
        schema: outputConfig.format.schema,
      },
    };
  }
  return converted;
}

function convertToolChoice(choice: unknown):
  | {
      toolChoice: unknown;
      parallelToolCalls?: boolean;
    }
  | undefined {
  if (choice === undefined) return undefined;
  if (!isObject(choice) || typeof choice.type !== "string") {
    return undefined;
  }
  let toolChoice: unknown;
  if (choice.type === "auto" || choice.type === "none")
    toolChoice = choice.type;
  else if (choice.type === "any") toolChoice = "required";
  else if (choice.type === "tool" && typeof choice.name === "string") {
    toolChoice = { type: "function", function: { name: choice.name } };
  } else return undefined;
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

export function convertMessagesRequest(rawBody: unknown): {
  chat: JsonObject & { model: string };
  request: MessagesRequest;
} {
  if (
    !isObject(rawBody) ||
    typeof rawBody.model !== "string" ||
    !Array.isArray(rawBody.messages) ||
    typeof rawBody.max_tokens !== "number"
  ) {
    throw new Error("Invalid request.");
  }
  const body = selectSupportedRequestFields(
    rawBody,
  ) as unknown as MessagesRequest;
  if (body.metadata !== undefined) {
    if (!isObject(body.metadata)) unsupported("metadata");
    if (
      body.metadata.user_id !== undefined &&
      body.metadata.user_id !== null &&
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
  const outputConfig = convertOutputConfig(body.output_config);
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
      ...outputConfig,
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
