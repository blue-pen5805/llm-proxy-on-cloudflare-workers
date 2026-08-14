import { openAIErrorResponse } from "../error_response";
import { isJsonObject as isObject, type JsonObject } from "../sse";

const IGNORED_REQUEST_FIELDS = new Set([
  "background",
  "context_management",
  "conversation",
  "include",
  "max_tool_calls",
  "moderation",
  "previous_response_id",
  "prompt",
  "prompt_cache_key",
  "prompt_cache_options",
  "prompt_cache_retention",
  "safety_identifier",
  "stream_options",
  "truncation",
]);
const SUPPORTED_REQUEST_FIELDS = new Set([
  "frequency_penalty",
  "input",
  "instructions",
  "logprobs",
  "max_output_tokens",
  "metadata",
  "model",
  "parallel_tool_calls",
  "presence_penalty",
  "reasoning",
  "seed",
  "service_tier",
  "store",
  "stream",
  "temperature",
  "text",
  "tool_choice",
  "tools",
  "top_logprobs",
  "top_p",
  "user",
]);

export interface ResponsesRequest extends JsonObject {
  model: string;
  input: unknown;
}

export interface ResponseProfile {
  instructions: string | null;
  maxOutputTokens: number | null;
  metadata: JsonObject;
  model: string;
  parallelToolCalls: boolean;
  reasoningEffort: string | null;
  serviceTier: string | null;
  store: boolean;
  temperature: number | null;
  text: JsonObject;
  toolChoice: unknown;
  tools: unknown[];
  topP: number | null;
  truncation: string;
  user: string | null;
}

export interface ChatUsage extends JsonObject {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  total_tokens?: unknown;
  prompt_tokens_details?: unknown;
  completion_tokens_details?: unknown;
}

export function invalidRequest(message: string): Response {
  return openAIErrorResponse(message, 400);
}

function unsupported(field: string): never {
  throw new Error(`Responses field is not supported: ${field}.`);
}

export function textValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function convertContentPart(part: unknown): JsonObject {
  if (!isObject(part) || typeof part.type !== "string") {
    return unsupported("input.content");
  }
  if (part.type === "input_text" || part.type === "output_text") {
    if (typeof part.text !== "string") return unsupported("input.content.text");
    return { type: "text", text: part.text };
  }
  if (part.type === "text" && typeof part.text === "string") {
    return { type: "text", text: part.text };
  }
  if (part.type === "refusal" && typeof part.refusal === "string") {
    return { type: "text", text: part.refusal };
  }
  if (part.type === "input_image") {
    if (typeof part.image_url !== "string") {
      return unsupported("input_image.file_id");
    }
    if (
      part.detail !== undefined &&
      part.detail !== null &&
      !["auto", "low", "high"].includes(String(part.detail))
    ) {
      return unsupported("input_image.detail");
    }
    return {
      type: "image_url",
      image_url: {
        url: part.image_url,
        ...(["auto", "low", "high"].includes(String(part.detail))
          ? { detail: part.detail }
          : {}),
      },
    };
  }
  if (part.type === "input_file") {
    if (
      typeof part.file_id !== "string" &&
      typeof part.file_data !== "string"
    ) {
      return unsupported("input_file.file_url");
    }
    return {
      type: "file",
      file: {
        ...(typeof part.file_id === "string" ? { file_id: part.file_id } : {}),
        ...(typeof part.file_data === "string"
          ? { file_data: part.file_data }
          : {}),
        ...(typeof part.filename === "string"
          ? { filename: part.filename }
          : {}),
      },
    };
  }
  return unsupported(`input.content.${part.type}`);
}

function convertMessageContent(content: unknown): string | JsonObject[] {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return unsupported("input.content");
  return content.map(convertContentPart);
}

function convertInputItem(item: unknown): JsonObject {
  if (!isObject(item)) return unsupported("input[]");
  if (typeof item.role === "string") {
    if (!["user", "assistant", "system", "developer"].includes(item.role)) {
      return unsupported(`input.role.${item.role}`);
    }
    return {
      role: item.role === "developer" ? "system" : item.role,
      content: convertMessageContent(item.content),
    };
  }
  if (item.type === "function_call") {
    if (
      typeof item.call_id !== "string" ||
      typeof item.name !== "string" ||
      typeof item.arguments !== "string"
    ) {
      return unsupported("input.function_call");
    }
    return {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: item.call_id,
          type: "function",
          function: { name: item.name, arguments: item.arguments },
        },
      ],
    };
  }
  if (item.type === "custom_tool_call") {
    if (
      typeof item.call_id !== "string" ||
      typeof item.name !== "string" ||
      typeof item.input !== "string"
    ) {
      return unsupported("input.custom_tool_call");
    }
    return {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: item.call_id,
          type: "custom",
          custom: { name: item.name, input: item.input },
        },
      ],
    };
  }
  if (
    item.type === "function_call_output" ||
    item.type === "custom_tool_call_output"
  ) {
    if (typeof item.call_id !== "string") {
      return unsupported(`input.${item.type}`);
    }
    return {
      role: "tool",
      tool_call_id: item.call_id,
      content: convertToolOutput(item.output, item.type),
    };
  }
  return unsupported(`input.${String(item.type ?? "item")}`);
}

function convertToolOutput(output: unknown, field: string): unknown {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    return output.map((part) => {
      if (!isObject(part) || part.type !== "input_text") {
        return unsupported(`input.${field}.output`);
      }
      if (typeof part.text !== "string") {
        return unsupported(`input.${field}.output.text`);
      }
      return { type: "text", text: part.text };
    });
  }
  return JSON.stringify(output ?? "");
}

function convertTools(tools: unknown): JsonObject[] | undefined {
  if (tools === undefined) return undefined;
  if (!Array.isArray(tools)) return unsupported("tools");
  return tools.map((tool) => {
    if (!isObject(tool)) {
      return unsupported("tools.item");
    }
    if (tool.type === "custom") {
      if (typeof tool.name !== "string") {
        return unsupported("tools.custom.name");
      }
      if (tool.format !== undefined && !isObject(tool.format)) {
        return unsupported("tools.custom.format");
      }
      return {
        type: "custom",
        custom: {
          name: tool.name,
          ...(typeof tool.description === "string"
            ? { description: tool.description }
            : {}),
          ...(isObject(tool.format) ? { format: tool.format } : {}),
        },
      };
    }
    if (tool.type !== "function") {
      return unsupported(`tools.${String(tool.type)}`);
    }
    if (typeof tool.name !== "string")
      return unsupported("tools.function.name");
    return {
      type: "function",
      function: {
        name: tool.name,
        ...(typeof tool.description === "string"
          ? { description: tool.description }
          : {}),
        ...(isObject(tool.parameters) ? { parameters: tool.parameters } : {}),
        ...(typeof tool.strict === "boolean" || tool.strict === null
          ? { strict: tool.strict }
          : {}),
      },
    };
  });
}

function convertAllowedTool(tool: unknown): JsonObject {
  if (
    !isObject(tool) ||
    !["function", "custom"].includes(String(tool.type)) ||
    typeof tool.name !== "string"
  ) {
    return unsupported("tool_choice.allowed_tools.tools");
  }
  return tool.type === "function"
    ? { type: "function", function: { name: tool.name } }
    : { type: "custom", custom: { name: tool.name } };
}

function convertToolChoice(toolChoice: unknown): unknown {
  if (toolChoice === undefined || typeof toolChoice === "string") {
    return toolChoice;
  }
  if (
    isObject(toolChoice) &&
    toolChoice.type === "function" &&
    typeof toolChoice.name === "string"
  ) {
    return { type: "function", function: { name: toolChoice.name } };
  }
  if (
    isObject(toolChoice) &&
    toolChoice.type === "custom" &&
    typeof toolChoice.name === "string"
  ) {
    return { type: "custom", custom: { name: toolChoice.name } };
  }
  if (
    isObject(toolChoice) &&
    toolChoice.type === "allowed_tools" &&
    ["auto", "required"].includes(String(toolChoice.mode)) &&
    Array.isArray(toolChoice.tools)
  ) {
    return {
      type: "allowed_tools",
      allowed_tools: {
        mode: toolChoice.mode,
        tools: toolChoice.tools.map(convertAllowedTool),
      },
    };
  }
  return unsupported("tool_choice");
}

function convertText(text: unknown): {
  responseFormat: unknown;
  verbosity: unknown;
} {
  if (text === undefined) {
    return { responseFormat: undefined, verbosity: undefined };
  }
  if (!isObject(text)) return unsupported("text");
  const verbosity = text.verbosity;
  if (
    verbosity !== undefined &&
    verbosity !== null &&
    !["low", "medium", "high"].includes(String(verbosity))
  ) {
    return unsupported("text.verbosity");
  }
  if (text.format === undefined) {
    return { responseFormat: undefined, verbosity };
  }
  if (!isObject(text.format) || typeof text.format.type !== "string") {
    return unsupported("text.format");
  }
  if (text.format.type === "text" || text.format.type === "json_object") {
    return {
      responseFormat: { type: text.format.type },
      verbosity,
    };
  }
  if (
    text.format.type === "json_schema" &&
    typeof text.format.name === "string" &&
    isObject(text.format.schema)
  ) {
    return {
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: text.format.name,
          schema: text.format.schema,
          ...(typeof text.format.description === "string"
            ? { description: text.format.description }
            : {}),
          ...(typeof text.format.strict === "boolean"
            ? { strict: text.format.strict }
            : {}),
        },
      },
      verbosity,
    };
  }
  return unsupported("text.format");
}

export function convertResponsesRequest(body: unknown): {
  chat: JsonObject & { model: string };
  request: ResponsesRequest;
} {
  if (!isObject(body) || typeof body.model !== "string" || !("input" in body)) {
    throw new Error("Invalid request.");
  }
  for (const field of Object.keys(body)) {
    if (
      !SUPPORTED_REQUEST_FIELDS.has(field) &&
      !IGNORED_REQUEST_FIELDS.has(field)
    ) {
      unsupported(field);
    }
  }
  if (body.store === true) unsupported("store");
  const messages: JsonObject[] = [];
  if (body.instructions !== undefined) {
    if (typeof body.instructions !== "string") unsupported("instructions");
    messages.push({ role: "system", content: body.instructions });
  }
  if (typeof body.input === "string") {
    messages.push({ role: "user", content: body.input });
  } else if (Array.isArray(body.input)) {
    for (const item of body.input) messages.push(convertInputItem(item));
  } else {
    unsupported("input");
  }

  const tools = convertTools(body.tools);
  const toolChoice = convertToolChoice(body.tool_choice);
  const { responseFormat, verbosity } = convertText(body.text);
  const reasoningEffort = isObject(body.reasoning)
    ? textValue(body.reasoning.effort)
    : undefined;
  if (body.reasoning !== undefined && !isObject(body.reasoning)) {
    unsupported("reasoning");
  }

  return {
    request: body as ResponsesRequest,
    chat: {
      model: body.model,
      messages,
      ...(body.stream === undefined ? {} : { stream: body.stream }),
      ...(body.stream === true
        ? { stream_options: { include_usage: true } }
        : {}),
      ...(tools === undefined ? {} : { tools }),
      ...(toolChoice === undefined ? {} : { tool_choice: toolChoice }),
      ...(responseFormat === undefined
        ? {}
        : { response_format: responseFormat }),
      ...(verbosity === undefined ? {} : { verbosity }),
      ...(reasoningEffort === undefined
        ? {}
        : { reasoning_effort: reasoningEffort }),
      ...(body.max_output_tokens === undefined
        ? {}
        : { max_completion_tokens: body.max_output_tokens }),
      ...copyDefined(body, [
        "frequency_penalty",
        "logprobs",
        "metadata",
        "parallel_tool_calls",
        "presence_penalty",
        "seed",
        "service_tier",
        "store",
        "temperature",
        "top_logprobs",
        "top_p",
        "user",
      ]),
    },
  };
}

function copyDefined(
  source: JsonObject,
  fields: readonly string[],
): JsonObject {
  const copied: JsonObject = {};
  for (const field of fields) {
    const value = source[field];
    if (value !== undefined) copied[field] = value;
  }
  return copied;
}
