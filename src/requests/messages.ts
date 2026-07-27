import { CloudflareAIGateway } from "../ai_gateway";
import { MiddlewareContext } from "../middleware";
import { Config } from "../utils/config";
import { AppError } from "../utils/error";
import { readRequestText, readResponseJson } from "../utils/helpers";
import { RequestLogger } from "../utils/logger";
import { handleChatCompletionsRequest } from "./chat_completions";
import { anthropicErrorResponse } from "./error_response";
import { createSseRecordTransform, sseData } from "./sse";
import { StreamingResponseBudget } from "./stream_limits";

const MAX_CONVERTED_RESPONSE_BYTES = 5 * 1024 * 1024;
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

type JsonObject = Record<string, unknown>;

interface MessagesRequest extends JsonObject {
  max_tokens: number;
  messages: unknown[];
  model: string;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidRequest(message: string): Response {
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

function convertMessagesRequest(body: unknown): {
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

function convertedResponseHeaders(headers: Headers): Headers {
  const converted = new Headers(headers);
  for (const field of [
    "content-encoding",
    "content-length",
    "content-md5",
    "digest",
    "etag",
  ]) {
    converted.delete(field);
  }
  return converted;
}

function messageId(): string {
  return `msg_${crypto.randomUUID().replaceAll("-", "")}`;
}

function stopReason(reason: unknown): string {
  if (reason === "length") return "max_tokens";
  if (reason === "tool_calls" || reason === "function_call") return "tool_use";
  if (reason === "content_filter") return "refusal";
  return "end_turn";
}

function convertUsage(usage: unknown): JsonObject {
  const typed = isObject(usage) ? usage : {};
  const promptDetails = isObject(typed.prompt_tokens_details)
    ? typed.prompt_tokens_details
    : {};
  return {
    input_tokens:
      typeof typed.prompt_tokens === "number" ? typed.prompt_tokens : 0,
    output_tokens:
      typeof typed.completion_tokens === "number" ? typed.completion_tokens : 0,
    ...(typeof promptDetails.cached_tokens === "number"
      ? { cache_read_input_tokens: promptDetails.cached_tokens }
      : {}),
  };
}

function convertContent(message: JsonObject): JsonObject[] {
  const content: JsonObject[] = [];
  if (typeof message.content === "string" && message.content) {
    content.push({ type: "text", text: message.content });
  }
  if (typeof message.refusal === "string" && message.refusal) {
    content.push({ type: "text", text: message.refusal });
  }
  if (Array.isArray(message.tool_calls)) {
    for (const call of message.tool_calls) {
      if (!isObject(call) || !isObject(call.function)) continue;
      let input: unknown = {};
      if (typeof call.function.arguments === "string") {
        try {
          input = JSON.parse(call.function.arguments) as unknown;
        } catch {
          input = {};
        }
      }
      content.push({
        type: "tool_use",
        id:
          typeof call.id === "string"
            ? call.id
            : `toolu_${crypto.randomUUID()}`,
        name: typeof call.function.name === "string" ? call.function.name : "",
        input,
      });
    }
  }
  return content;
}

function invalidUpstreamResponse(): Response {
  return Response.json(
    {
      type: "error",
      error: {
        type: "api_error",
        message: "Upstream returned an invalid Chat Completions response.",
      },
    },
    { status: 502 },
  );
}

async function convertJsonResponse(
  response: Response,
  request: MessagesRequest,
  responseMetadataEnabled: boolean,
): Promise<Response> {
  let body: unknown;
  try {
    body = await readResponseJson(response, MAX_CONVERTED_RESPONSE_BYTES);
  } catch {
    return invalidUpstreamResponse();
  }
  if (!isObject(body) || !Array.isArray(body.choices))
    return invalidUpstreamResponse();
  const choice = body.choices.find(isObject);
  const message = choice && isObject(choice.message) ? choice.message : {};
  const converted = {
    id: messageId(),
    type: "message",
    role: "assistant",
    content: convertContent(message),
    model: request.model,
    stop_reason: stopReason(choice?.finish_reason),
    stop_sequence: null,
    usage: convertUsage(body.usage),
    ...(responseMetadataEnabled && isObject(body.llm_proxy)
      ? { llm_proxy: body.llm_proxy }
      : {}),
  };
  return new Response(JSON.stringify(converted), {
    status: response.status,
    statusText: response.statusText,
    headers: convertedResponseHeaders(response.headers),
  });
}

interface StreamingTool {
  id: string;
  name: string;
  input: string;
}

export function convertStreamingResponse(
  response: Response,
  request: MessagesRequest,
  responseMetadataEnabled: boolean,
): Response {
  if (!response.body) return invalidUpstreamResponse();
  const encoder = new TextEncoder();
  const budget = new StreamingResponseBudget();
  const id = messageId();
  let started = false;
  let finished = false;
  let finishReason: unknown;
  let usage: JsonObject = { input_tokens: 0, output_tokens: 0 };
  let proxyMetadata: JsonObject | undefined;
  let textOutputIndex: number | undefined;
  const tools = new Map<number, StreamingTool>();

  const event = (
    controller: TransformStreamDefaultController<Uint8Array>,
    type: string,
    data: JsonObject,
  ) => {
    controller.enqueue(
      encoder.encode(
        `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`,
      ),
    );
  };
  const start = (controller: TransformStreamDefaultController<Uint8Array>) => {
    if (started) return;
    started = true;
    event(controller, "message_start", {
      message: {
        id,
        type: "message",
        role: "assistant",
        content: [],
        model: request.model,
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
  };
  const startText = (
    controller: TransformStreamDefaultController<Uint8Array>,
  ) => {
    if (textOutputIndex !== undefined) return;
    const limitError = budget.addOutputItem();
    if (limitError) {
      fail(controller, limitError);
      return;
    }
    textOutputIndex = 0;
    event(controller, "content_block_start", {
      index: textOutputIndex,
      content_block: { type: "text", text: "" },
    });
  };
  const finish = (controller: TransformStreamDefaultController<Uint8Array>) => {
    start(controller);
    finished = true;
    // Anthropic content blocks do not interleave: one block is opened, filled,
    // and stopped before the next begins. Chat Completions may emit text and
    // tool-call deltas in the same chunk, so tool arguments are accumulated
    // (within the existing streaming budget) and each tool_use block is
    // emitted in full after the text block is closed.
    let outputIndex = textOutputIndex === undefined ? 0 : textOutputIndex + 1;
    if (textOutputIndex !== undefined) {
      event(controller, "content_block_stop", { index: textOutputIndex });
    }
    for (const tool of tools.values()) {
      const index = outputIndex++;
      event(controller, "content_block_start", {
        index,
        content_block: {
          type: "tool_use",
          id: tool.id,
          name: tool.name,
          input: {},
        },
      });
      if (tool.input) {
        event(controller, "content_block_delta", {
          index,
          delta: { type: "input_json_delta", partial_json: tool.input },
        });
      }
      event(controller, "content_block_stop", { index });
    }
    event(controller, "message_delta", {
      delta: { stop_reason: stopReason(finishReason), stop_sequence: null },
      usage,
      ...(responseMetadataEnabled && proxyMetadata
        ? { llm_proxy: proxyMetadata }
        : {}),
    });
    event(controller, "message_stop", {});
  };
  const fail = (
    controller: TransformStreamDefaultController<Uint8Array>,
    error: Error,
  ) => {
    start(controller);
    finished = true;
    event(controller, "error", {
      error: {
        type: "api_error",
        message: error.message,
      },
    });
    controller.terminate();
  };
  const processData = (
    data: string,
    controller: TransformStreamDefaultController<Uint8Array>,
  ) => {
    start(controller);
    if (data === "[DONE]") {
      finish(controller);
      controller.terminate();
      return;
    }
    let chunk: unknown;
    try {
      chunk = JSON.parse(data) as unknown;
    } catch {
      fail(
        controller,
        new Error("Upstream returned an invalid streaming chunk."),
      );
      return;
    }
    if (!isObject(chunk)) return;
    if (responseMetadataEnabled && isObject(chunk.llm_proxy))
      proxyMetadata = chunk.llm_proxy;
    if (chunk.usage !== undefined) usage = convertUsage(chunk.usage);
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
        startText(controller);
        if (finished) return;
        event(controller, "content_block_delta", {
          index: textOutputIndex,
          delta: { type: "text_delta", text: choice.delta.content },
        });
      }
      if (!Array.isArray(choice.delta.tool_calls)) continue;
      for (const callDelta of choice.delta.tool_calls) {
        if (!isObject(callDelta) || typeof callDelta.index !== "number")
          continue;
        const fn = isObject(callDelta.function) ? callDelta.function : {};
        let tool = tools.get(callDelta.index);
        if (!tool) {
          const limitError = budget.addTool() ?? budget.addOutputItem();
          if (limitError) {
            fail(controller, limitError);
            return;
          }
          tool = {
            id:
              typeof callDelta.id === "string"
                ? callDelta.id
                : `toolu_${crypto.randomUUID()}`,
            name: typeof fn.name === "string" ? fn.name : "",
            input: "",
          };
          tools.set(callDelta.index, tool);
        } else if (typeof fn.name === "string" && fn.name !== tool.name) {
          tool.name = fn.name;
        }
        if (typeof fn.arguments === "string") {
          const limitError = budget.addToolArguments(fn.arguments);
          if (limitError) {
            fail(controller, limitError);
            return;
          }
          tool.input += fn.arguments;
        }
      }
    }
  };
  const body = response.body.pipeThrough(
    createSseRecordTransform({
      budget,
      onRecord(block, _separator, controller) {
        const data = sseData(block);
        if (data !== undefined) processData(data, controller);
      },
      onError(error, controller) {
        fail(controller, error);
      },
      onEnd(pending, controller) {
        if (pending.trim()) {
          const data = sseData(pending);
          if (data !== undefined) processData(data, controller);
        }
        if (finished) return;
        fail(
          controller,
          new Error("Upstream stream ended without a terminal event."),
        );
      },
      isFinished: () => finished,
    }),
  );
  const headers = convertedResponseHeaders(response.headers);
  headers.set("content-type", "text/event-stream; charset=utf-8");
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function convertChatResponse(
  response: Response,
  request: MessagesRequest,
  responseMetadataEnabled: boolean,
): Promise<Response> {
  if (!response.ok) return response;
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  return contentType.includes("text/event-stream")
    ? convertStreamingResponse(response, request, responseMetadataEnabled)
    : convertJsonResponse(response, request, responseMetadataEnabled);
}

/** Translate Anthropic Messages requests onto the existing Chat Completions flow. */
export async function handleMessagesRequest(
  context: MiddlewareContext,
  aiGateway: CloudflareAIGateway | undefined = undefined,
): Promise<Response> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readRequestText(context.request)) as unknown;
  } catch (error) {
    if (error instanceof AppError) throw error;
    RequestLogger.start({ endpoint: "messages" });
    return invalidRequest("Request body must be valid JSON.");
  }
  let converted: ReturnType<typeof convertMessagesRequest>;
  try {
    converted = convertMessagesRequest(parsed);
  } catch (error) {
    RequestLogger.start({ endpoint: "messages" });
    return invalidRequest((error as Error).message);
  }

  const headers = new Headers(context.request.headers);
  headers.delete("content-length");
  headers.delete("anthropic-version");
  headers.delete("anthropic-beta");
  const responseMetadataEnabled = Config.chatResponseMetadataEnabled();
  const chatResponse = await handleChatCompletionsRequest(context, aiGateway, {
    body: converted.chat,
    endpoint: "messages",
    headers,
    responseMetadataEnabled,
  });
  return convertChatResponse(
    chatResponse,
    converted.request,
    responseMetadataEnabled,
  );
}
