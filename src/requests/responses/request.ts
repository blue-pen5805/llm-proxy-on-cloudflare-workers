import { openAIErrorResponse } from "../error_response";
import { isJsonObject as isObject, type JsonObject } from "../sse";
import type { ResponsesRequest } from "./types";

export type { ResponsesRequest } from "./types";

/** Top-level Responses fields with an implemented Chat Completions conversion. */
export const SUPPORTED_REQUEST_FIELDS: ReadonlySet<keyof ResponsesRequest> =
  new Set<keyof ResponsesRequest>([
    "frequency_penalty",
    "include",
    "input",
    "instructions",
    "logprobs",
    "max_output_tokens",
    "metadata",
    "model",
    "moderation",
    "parallel_tool_calls",
    "presence_penalty",
    "prompt_cache_key",
    "prompt_cache_options",
    "prompt_cache_retention",
    "reasoning",
    "safety_identifier",
    "seed",
    "service_tier",
    "store",
    "stream",
    "stream_options",
    "temperature",
    "text",
    "tool_choice",
    "tools",
    "top_logprobs",
    "top_p",
    "user",
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

function promptCacheBreakpoint(value: unknown): JsonObject | undefined {
  if (value === undefined) return undefined;
  return isObject(value) && value.mode === "explicit"
    ? { mode: "explicit" }
    : undefined;
}

export function textValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function convertContentPart(part: unknown): JsonObject | undefined {
  if (!isObject(part) || typeof part.type !== "string") {
    return unsupported("input.content");
  }
  if (part.type === "input_text" || part.type === "output_text") {
    if (typeof part.text !== "string") return unsupported("input.content.text");
    const breakpoint = promptCacheBreakpoint(part.prompt_cache_breakpoint);
    return {
      type: "text",
      text: part.text,
      ...(breakpoint ? { prompt_cache_breakpoint: breakpoint } : {}),
    };
  }
  if (part.type === "text" && typeof part.text === "string") {
    const breakpoint = promptCacheBreakpoint(part.prompt_cache_breakpoint);
    return {
      type: "text",
      text: part.text,
      ...(breakpoint ? { prompt_cache_breakpoint: breakpoint } : {}),
    };
  }
  if (part.type === "refusal" && typeof part.refusal === "string") {
    return { type: "text", text: part.refusal };
  }
  if (part.type === "input_image") {
    if (typeof part.image_url !== "string") {
      return undefined;
    }
    const breakpoint = promptCacheBreakpoint(part.prompt_cache_breakpoint);
    return {
      type: "image_url",
      image_url: {
        url: part.image_url,
        ...(["auto", "low", "high"].includes(String(part.detail))
          ? { detail: part.detail }
          : {}),
      },
      ...(breakpoint ? { prompt_cache_breakpoint: breakpoint } : {}),
    };
  }
  if (part.type === "input_file") {
    if (
      typeof part.file_id !== "string" &&
      typeof part.file_data !== "string"
    ) {
      return undefined;
    }
    const breakpoint = promptCacheBreakpoint(part.prompt_cache_breakpoint);
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
      ...(breakpoint ? { prompt_cache_breakpoint: breakpoint } : {}),
    };
  }
  return undefined;
}

function convertMessageContent(content: unknown): string | JsonObject[] {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return unsupported("input.content");
  return content
    .map(convertContentPart)
    .filter((part): part is JsonObject => part !== undefined);
}

function convertInputItem(item: unknown): JsonObject | undefined {
  if (!isObject(item)) return unsupported("input[]");
  if (typeof item.role === "string") {
    if (!["user", "assistant", "system", "developer"].includes(item.role)) {
      return undefined;
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
  return undefined;
}

function convertToolOutput(output: unknown, field: string): unknown {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    return output.flatMap((part) => {
      if (!isObject(part) || part.type !== "input_text") {
        return [];
      }
      if (typeof part.text !== "string") {
        return unsupported(`input.${field}.output.text`);
      }
      return [{ type: "text", text: part.text }];
    });
  }
  return JSON.stringify(output ?? "");
}

function convertTools(tools: unknown): JsonObject[] | undefined {
  if (tools === undefined) return undefined;
  if (!Array.isArray(tools)) return unsupported("tools");
  const converted = tools.flatMap((tool): JsonObject[] => {
    if (!isObject(tool)) {
      return [];
    }
    if (tool.type === "custom") {
      if (typeof tool.name !== "string") {
        return unsupported("tools.custom.name");
      }
      if (tool.format !== undefined && !isObject(tool.format)) {
        return unsupported("tools.custom.format");
      }
      return [
        {
          type: "custom",
          custom: {
            name: tool.name,
            ...(typeof tool.description === "string"
              ? { description: tool.description }
              : {}),
            ...(isObject(tool.format) ? { format: tool.format } : {}),
          },
        },
      ];
    }
    if (tool.type !== "function") {
      return [];
    }
    if (typeof tool.name !== "string")
      return unsupported("tools.function.name");
    return [
      {
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
      },
    ];
  });
  return converted.length === 0 ? undefined : converted;
}

function convertAllowedTool(tool: unknown): JsonObject | undefined {
  if (
    !isObject(tool) ||
    !["function", "custom"].includes(String(tool.type)) ||
    typeof tool.name !== "string"
  ) {
    return undefined;
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
    const convertedTools = toolChoice.tools
      .map(convertAllowedTool)
      .filter((tool): tool is JsonObject => tool !== undefined);
    if (convertedTools.length === 0) return undefined;
    return {
      type: "allowed_tools",
      allowed_tools: {
        mode: toolChoice.mode,
        tools: convertedTools,
      },
    };
  }
  return undefined;
}

function convertText(text: unknown): {
  responseFormat: unknown;
  verbosity: unknown;
} {
  if (text === undefined) {
    return { responseFormat: undefined, verbosity: undefined };
  }
  if (!isObject(text)) return unsupported("text");
  const verbosity =
    text.verbosity === null ||
    ["low", "medium", "high"].includes(String(text.verbosity))
      ? text.verbosity
      : undefined;
  if (text.format === undefined) {
    return { responseFormat: undefined, verbosity };
  }
  if (!isObject(text.format) || typeof text.format.type !== "string")
    return { responseFormat: undefined, verbosity };
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
  return { responseFormat: undefined, verbosity };
}

export function convertResponsesRequest(rawBody: unknown): {
  chat: JsonObject & { model: string };
  request: ResponsesRequest;
} {
  if (
    !isObject(rawBody) ||
    typeof rawBody.model !== "string" ||
    !("input" in rawBody)
  ) {
    throw new Error("Invalid request.");
  }
  const body = selectSupportedRequestFields(
    rawBody,
  ) as unknown as ResponsesRequest;
  const includeLogprobs =
    Array.isArray(body.include) &&
    body.include.includes("message.output_text.logprobs");
  if (body.stream_options !== undefined && body.stream_options !== null) {
    if (!isObject(body.stream_options)) unsupported("stream_options");
    if (
      body.stream_options.include_obfuscation !== undefined &&
      typeof body.stream_options.include_obfuscation !== "boolean"
    ) {
      unsupported("stream_options.include_obfuscation");
    }
  }
  const messages: JsonObject[] = [];
  if (body.instructions !== undefined && body.instructions !== null) {
    if (typeof body.instructions !== "string") unsupported("instructions");
    messages.push({ role: "system", content: body.instructions });
  }
  if (typeof body.input === "string") {
    messages.push({ role: "user", content: body.input });
  } else if (Array.isArray(body.input)) {
    for (const item of body.input) {
      const converted = convertInputItem(item);
      if (converted) messages.push(converted);
    }
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
        ? {
            stream_options: {
              ...(isObject(body.stream_options) &&
              typeof body.stream_options.include_obfuscation === "boolean"
                ? {
                    include_obfuscation:
                      body.stream_options.include_obfuscation,
                  }
                : {}),
              include_usage: true,
            },
          }
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
        "moderation",
        "parallel_tool_calls",
        "prompt_cache_key",
        "prompt_cache_options",
        "prompt_cache_retention",
        "presence_penalty",
        "safety_identifier",
        "seed",
        "service_tier",
        "store",
        "temperature",
        "top_logprobs",
        "top_p",
        "user",
      ]),
      ...(typeof body.top_logprobs !== "number" && !includeLogprobs
        ? {}
        : { logprobs: true }),
    },
  };
}

function copyDefined(
  source: ResponsesRequest,
  fields: readonly (keyof ResponsesRequest)[],
): JsonObject {
  const copied: JsonObject = {};
  for (const field of fields) {
    const value = source[field];
    if (value !== undefined) copied[field] = value;
  }
  return copied;
}
