import { CloudflareAIGateway } from "../ai_gateway";
import { MiddlewareContext } from "../middleware";
import { Config } from "../utils/config";
import { AppError } from "../utils/error";
import { readRequestText, readResponseJson } from "../utils/helpers";
import { RequestLogger } from "../utils/logger";
import { handleChatCompletionsRequest } from "./chat_completions";
import { openAIErrorResponse } from "./error_response";
import { headersForRewrittenBody } from "./response";
import {
  createChatCompletionSseTransform,
  isJsonObject as isObject,
  type JsonObject,
} from "./sse";
import { StreamingResponseBudget } from "./stream_limits";

const MAX_CONVERTED_RESPONSE_BYTES = 5 * 1024 * 1024;
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

interface ResponsesRequest extends JsonObject {
  model: string;
  input: unknown;
}

interface ResponseProfile {
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

interface ChatUsage extends JsonObject {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  total_tokens?: unknown;
  prompt_tokens_details?: unknown;
  completion_tokens_details?: unknown;
}

function invalidRequest(message: string): Response {
  return openAIErrorResponse(message, 400);
}

function unsupported(field: string): never {
  throw new Error(`Responses field is not supported: ${field}.`);
}

function textValue(value: unknown): string | undefined {
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

function convertResponsesRequest(body: unknown): {
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

function profileFor(request: ResponsesRequest): ResponseProfile {
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

function responseId(): string {
  return `resp_${crypto.randomUUID().replaceAll("-", "")}`;
}

function itemId(prefix: "msg" | "fc" | "ctc"): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function convertUsage(usage: unknown): JsonObject | null {
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

function baseResponse(
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
    max_tool_calls: null,
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

function convertChatOutput(message: JsonObject): unknown[] {
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
          ? [{ type: "output_text", text: content, annotations: [] }]
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

async function convertJsonResponse(
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
    convertChatOutput(message),
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

interface StreamingToolCall {
  kind: "function" | "custom";
  id: string;
  callId: string;
  name: string;
  input: string;
  outputIndex: number;
}

export function convertStreamingResponse(
  response: Response,
  request: ResponsesRequest,
  responseMetadataEnabled: boolean,
): Response {
  if (!response.body) return invalidUpstreamResponse();
  const encoder = new TextEncoder();
  const budget = new StreamingResponseBudget();
  const id = responseId();
  const createdAt = Math.floor(Date.now() / 1000);
  const profile = profileFor(request);
  let sequenceNumber = 0;
  let started = false;
  let finished = false;
  let text = "";
  let messageId: string | undefined;
  let messageOutputIndex: number | undefined;
  let usage: JsonObject | null = null;
  let proxyMetadata: JsonObject | undefined;
  let finishReason: unknown;
  let nextOutputIndex = 0;
  const tools = new Map<number, StreamingToolCall>();
  const output: unknown[] = [];

  const event = (
    controller: TransformStreamDefaultController<Uint8Array>,
    type: string,
    fields: JsonObject,
  ) => {
    const data = { type, sequence_number: sequenceNumber++, ...fields };
    controller.enqueue(
      encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`),
    );
  };
  const start = (controller: TransformStreamDefaultController<Uint8Array>) => {
    if (started) return;
    started = true;
    const inProgress = baseResponse(
      id,
      createdAt,
      "in_progress",
      profile,
      [],
      null,
      undefined,
    );
    event(controller, "response.created", { response: inProgress });
    event(controller, "response.in_progress", { response: inProgress });
  };
  const startMessage = (
    controller: TransformStreamDefaultController<Uint8Array>,
  ) => {
    if (messageId) return;
    const limitError = budget.addOutputItem();
    if (limitError) {
      fail(controller, limitError);
      return;
    }
    messageId = itemId("msg");
    messageOutputIndex = nextOutputIndex++;
    const item = {
      id: messageId,
      type: "message",
      status: "in_progress",
      role: "assistant",
      content: [],
    };
    event(controller, "response.output_item.added", {
      output_index: messageOutputIndex,
      item,
    });
    event(controller, "response.content_part.added", {
      item_id: messageId,
      output_index: messageOutputIndex,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    });
  };
  const finish = (controller: TransformStreamDefaultController<Uint8Array>) => {
    start(controller);
    finished = true;
    if (messageId && messageOutputIndex !== undefined) {
      const part = { type: "output_text", text, annotations: [] };
      const item = {
        id: messageId,
        type: "message",
        status: "completed",
        role: "assistant",
        content: [part],
      };
      event(controller, "response.output_text.done", {
        item_id: messageId,
        output_index: messageOutputIndex,
        content_index: 0,
        text,
      });
      event(controller, "response.content_part.done", {
        item_id: messageId,
        output_index: messageOutputIndex,
        content_index: 0,
        part,
      });
      event(controller, "response.output_item.done", {
        output_index: messageOutputIndex,
        item,
      });
      output[messageOutputIndex] = item;
    }
    for (const tool of tools.values()) {
      const custom = tool.kind === "custom";
      const item = {
        id: tool.id,
        type: custom ? "custom_tool_call" : "function_call",
        status: "completed",
        call_id: tool.callId,
        name: tool.name,
        [custom ? "input" : "arguments"]: tool.input,
      };
      event(
        controller,
        custom
          ? "response.custom_tool_call_input.done"
          : "response.function_call_arguments.done",
        {
          item_id: tool.id,
          output_index: tool.outputIndex,
          [custom ? "input" : "arguments"]: tool.input,
        },
      );
      event(controller, "response.output_item.done", {
        output_index: tool.outputIndex,
        item,
      });
      output[tool.outputIndex] = item;
    }
    const status = finishReason === "length" ? "incomplete" : "completed";
    event(controller, `response.${status}`, {
      response: baseResponse(
        id,
        createdAt,
        status,
        profile,
        output.filter((item) => item !== undefined),
        usage,
        proxyMetadata,
      ),
    });
  };
  const fail = (
    controller: TransformStreamDefaultController<Uint8Array>,
    error: Error,
  ) => {
    start(controller);
    finished = true;
    event(controller, "error", {
      error: {
        type: "stream_error",
        message: error.message,
      },
    });
    controller.terminate();
  };
  const processChunk = (
    chunk: JsonObject,
    controller: TransformStreamDefaultController<Uint8Array>,
  ) => {
    start(controller);
    if (responseMetadataEnabled && isObject(chunk.llm_proxy)) {
      proxyMetadata = chunk.llm_proxy;
    }
    usage = convertUsage(chunk.usage) ?? usage;
    if (!Array.isArray(chunk.choices)) return;
    for (const choice of chunk.choices) {
      if (!isObject(choice)) continue;
      if (choice.finish_reason !== null && choice.finish_reason !== undefined) {
        finishReason = choice.finish_reason;
      }
      if (!isObject(choice.delta)) continue;
      if (typeof choice.delta.content === "string") {
        const limitError = budget.addText(choice.delta.content);
        if (limitError) {
          fail(controller, limitError);
          return;
        }
        startMessage(controller);
        if (finished) return;
        text += choice.delta.content;
        event(controller, "response.output_text.delta", {
          item_id: messageId,
          output_index: messageOutputIndex,
          content_index: 0,
          delta: choice.delta.content,
        });
      }
      if (!Array.isArray(choice.delta.tool_calls)) continue;
      for (const callDelta of choice.delta.tool_calls) {
        if (!isObject(callDelta) || typeof callDelta.index !== "number")
          continue;
        let tool = tools.get(callDelta.index);
        const fn = isObject(callDelta.function) ? callDelta.function : {};
        const custom = isObject(callDelta.custom) ? callDelta.custom : {};
        if (!tool) {
          const kind = callDelta.type === "custom" ? "custom" : "function";
          const idPrefix = kind === "custom" ? "ctc" : "fc";
          const callId = textValue(callDelta.id) ?? itemId(idPrefix);
          const name =
            textValue(kind === "custom" ? custom.name : fn.name) ?? "";
          const limitError =
            budget.addTool() ??
            budget.addOutputItem() ??
            budget.addToolMetadata(callId) ??
            budget.addToolMetadata(name);
          if (limitError) {
            fail(controller, limitError);
            return;
          }
          tool = {
            kind,
            id: itemId(idPrefix),
            callId,
            name,
            input: "",
            outputIndex: nextOutputIndex++,
          };
          tools.set(callDelta.index, tool);
          event(controller, "response.output_item.added", {
            output_index: tool.outputIndex,
            item: {
              id: tool.id,
              type:
                tool.kind === "custom" ? "custom_tool_call" : "function_call",
              status: "in_progress",
              call_id: tool.callId,
              name: tool.name,
              [tool.kind === "custom" ? "input" : "arguments"]: "",
            },
          });
        }
        const name = tool.kind === "custom" ? custom.name : fn.name;
        if (typeof name === "string" && name !== tool.name) {
          const limitError = budget.addToolMetadata(name);
          if (limitError) {
            fail(controller, limitError);
            return;
          }
          tool.name = name;
        }
        const input = tool.kind === "custom" ? custom.input : fn.arguments;
        if (typeof input === "string") {
          const limitError = budget.addToolArguments(input);
          if (limitError) {
            fail(controller, limitError);
            return;
          }
          tool.input += input;
          event(
            controller,
            tool.kind === "custom"
              ? "response.custom_tool_call_input.delta"
              : "response.function_call_arguments.delta",
            {
              item_id: tool.id,
              output_index: tool.outputIndex,
              delta: input,
            },
          );
        }
      }
    }
  };
  const body = response.body.pipeThrough(
    createChatCompletionSseTransform({
      budget,
      onChunk: processChunk,
      onDone(controller) {
        finish(controller);
        controller.terminate();
      },
      onError(error, controller) {
        fail(controller, error);
      },
      isFinished: () => finished,
    }),
  );
  const headers = headersForRewrittenBody(response.headers);
  headers.set("content-type", "text/event-stream; charset=utf-8");
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function convertChatResponse(
  response: Response,
  request: ResponsesRequest,
  responseMetadataEnabled: boolean,
): Promise<Response> {
  if (!response.ok) return response;
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  return contentType.includes("text/event-stream")
    ? convertStreamingResponse(response, request, responseMetadataEnabled)
    : convertJsonResponse(response, request, responseMetadataEnabled);
}

function invalidUpstreamResponse(): Response {
  return openAIErrorResponse(
    "Upstream returned an invalid Chat Completions response.",
    502,
  );
}

/** Translate OpenAI Responses requests onto the existing Chat Completions flow. */
export async function handleResponsesRequest(
  context: MiddlewareContext,
  aiGateway: CloudflareAIGateway | undefined = undefined,
): Promise<Response> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readRequestText(context.request)) as unknown;
  } catch (error) {
    if (error instanceof AppError) throw error;
    RequestLogger.start({ endpoint: "responses" });
    return invalidRequest("Request body must be valid JSON.");
  }
  let converted: ReturnType<typeof convertResponsesRequest>;
  try {
    converted = convertResponsesRequest(parsed);
  } catch (error) {
    RequestLogger.start({ endpoint: "responses" });
    return invalidRequest((error as Error).message);
  }

  const headers = new Headers(context.request.headers);
  headers.delete("content-length");
  const responseMetadataEnabled = Config.chatResponseMetadataEnabled();
  const chatResponse = await handleChatCompletionsRequest(context, aiGateway, {
    body: converted.chat,
    endpoint: "responses",
    headers,
    responseMetadataEnabled,
  });
  return convertChatResponse(
    chatResponse,
    converted.request,
    responseMetadataEnabled,
  );
}
