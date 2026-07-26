import { CloudflareAIGateway } from "../ai_gateway";
import { MiddlewareContext } from "../middleware";
import { Config } from "../utils/config";
import { readRequestText, readResponseJson } from "../utils/helpers";
import { RequestLogger } from "../utils/logger";
import { handleChatCompletionsRequest } from "./chat_completions";

const MAX_CONVERTED_RESPONSE_BYTES = 5 * 1024 * 1024;
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
  "truncation",
  "user",
]);

type JsonObject = Record<string, unknown>;

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

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
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
    return {
      type: "image_url",
      image_url: {
        url: part.image_url,
        ...(typeof part.detail === "string" ? { detail: part.detail } : {}),
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
  if (item.type === "function_call_output") {
    if (typeof item.call_id !== "string") {
      return unsupported("input.function_call_output");
    }
    return {
      role: "tool",
      tool_call_id: item.call_id,
      content:
        typeof item.output === "string"
          ? item.output
          : JSON.stringify(item.output ?? ""),
    };
  }
  return unsupported(`input.${String(item.type ?? "item")}`);
}

function convertTools(tools: unknown): JsonObject[] | undefined {
  if (tools === undefined) return undefined;
  if (!Array.isArray(tools)) return unsupported("tools");
  return tools.map((tool) => {
    if (!isObject(tool) || tool.type !== "function") {
      return unsupported(
        `tools.${isObject(tool) ? String(tool.type) : "item"}`,
      );
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
        ...(typeof tool.strict === "boolean" ? { strict: tool.strict } : {}),
      },
    };
  });
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
  return unsupported("tool_choice");
}

function convertTextFormat(text: unknown): unknown {
  if (text === undefined) return undefined;
  if (!isObject(text)) return unsupported("text");
  if (text.verbosity !== undefined) return unsupported("text.verbosity");
  if (text.format === undefined) return undefined;
  if (!isObject(text.format) || typeof text.format.type !== "string") {
    return unsupported("text.format");
  }
  if (text.format.type === "text" || text.format.type === "json_object") {
    return { type: text.format.type };
  }
  if (
    text.format.type === "json_schema" &&
    typeof text.format.name === "string" &&
    isObject(text.format.schema)
  ) {
    return {
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
    if (!SUPPORTED_REQUEST_FIELDS.has(field)) unsupported(field);
  }
  if (body.truncation !== undefined && body.truncation !== "disabled") {
    unsupported("truncation");
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
  const responseFormat = convertTextFormat(body.text);
  const reasoningEffort = isObject(body.reasoning)
    ? textValue(body.reasoning.effort)
    : undefined;
  if (
    body.reasoning !== undefined &&
    (!isObject(body.reasoning) ||
      Object.keys(body.reasoning).some((field) => field !== "effort"))
  ) {
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
    truncation: textValue(request.truncation) ?? "disabled",
    user: textValue(request.user) ?? null,
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

function responseId(): string {
  return `resp_${crypto.randomUUID().replaceAll("-", "")}`;
}

function itemId(prefix: "msg" | "fc"): string {
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
      if (!isObject(call) || !isObject(call.function)) continue;
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
    headers: convertedResponseHeaders(response.headers),
  });
}

interface StreamingToolCall {
  id: string;
  callId: string;
  name: string;
  arguments: string;
  outputIndex: number;
}

function convertStreamingResponse(
  response: Response,
  request: ResponsesRequest,
  responseMetadataEnabled: boolean,
): Response {
  if (!response.body) return invalidUpstreamResponse();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const id = responseId();
  const createdAt = Math.floor(Date.now() / 1000);
  const profile = profileFor(request);
  let pending = "";
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
    if (finished) return;
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
      const item = {
        id: tool.id,
        type: "function_call",
        status: "completed",
        call_id: tool.callId,
        name: tool.name,
        arguments: tool.arguments,
      };
      event(controller, "response.function_call_arguments.done", {
        item_id: tool.id,
        output_index: tool.outputIndex,
        arguments: tool.arguments,
      });
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
  const processData = (
    data: string,
    controller: TransformStreamDefaultController<Uint8Array>,
  ) => {
    start(controller);
    if (data === "[DONE]") {
      finish(controller);
      return;
    }
    let chunk: unknown;
    try {
      chunk = JSON.parse(data) as unknown;
    } catch {
      event(controller, "error", {
        error: { message: "Upstream returned an invalid streaming chunk." },
      });
      return;
    }
    if (!isObject(chunk)) return;
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
        startMessage(controller);
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
        if (!tool) {
          tool = {
            id: itemId("fc"),
            callId: textValue(callDelta.id) ?? itemId("fc"),
            name: textValue(fn.name) ?? "",
            arguments: "",
            outputIndex: nextOutputIndex++,
          };
          tools.set(callDelta.index, tool);
          event(controller, "response.output_item.added", {
            output_index: tool.outputIndex,
            item: {
              id: tool.id,
              type: "function_call",
              status: "in_progress",
              call_id: tool.callId,
              name: tool.name,
              arguments: "",
            },
          });
        }
        if (typeof fn.name === "string") tool.name = fn.name;
        if (typeof fn.arguments === "string") {
          tool.arguments += fn.arguments;
          event(controller, "response.function_call_arguments.delta", {
            item_id: tool.id,
            output_index: tool.outputIndex,
            delta: fn.arguments,
          });
        }
      }
    }
  };
  const processBlock = (
    block: string,
    controller: TransformStreamDefaultController<Uint8Array>,
  ) => {
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("data:"))
        processData(line.slice(5).trimStart(), controller);
    }
  };

  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        pending += decoder.decode(chunk, { stream: true });
        let boundary: number;
        while ((boundary = pending.search(/\r?\n\r?\n/)) >= 0) {
          const match = pending.slice(boundary).match(/^\r?\n\r?\n/)![0];
          const block = pending.slice(0, boundary);
          pending = pending.slice(boundary + match.length);
          processBlock(block, controller);
        }
      },
      flush(controller) {
        pending += decoder.decode();
        if (pending.trim()) processBlock(pending, controller);
        finish(controller);
      },
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
  return Response.json(
    { error: "Upstream returned an invalid Chat Completions response." },
    { status: 502 },
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
  } catch {
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
