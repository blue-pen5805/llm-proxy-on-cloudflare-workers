import { headersForRewrittenBody } from "../response";
import {
  createChatCompletionSseTransform,
  isJsonObject as isObject,
  type JsonObject,
} from "../sse";
import { StreamingResponseBudget } from "../stream_limits";
import { type ResponsesRequest, textValue } from "./request";
import {
  baseResponse,
  convertTokenLogprobs,
  convertUsage,
  invalidUpstreamResponse,
  itemId,
  profileFor,
  responseId,
} from "./response";

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
  const includeObfuscation =
    request.stream_options?.include_obfuscation !== false;
  let sequenceNumber = 0;
  let started = false;
  let finished = false;
  let text = "";
  const textLogprobs: JsonObject[] = [];
  const textEventLogprobs: JsonObject[] = [];
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
      const part = {
        type: "output_text",
        text,
        annotations: [],
        logprobs: textLogprobs,
      };
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
        logprobs: textEventLogprobs,
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
      code: "stream_error",
      message: error.message,
      param: null,
    });
    controller.terminate();
  };
  const processChunk = (
    chunk: JsonObject,
    controller: TransformStreamDefaultController<Uint8Array>,
  ) => {
    start(controller);
    let pendingObfuscation =
      includeObfuscation && typeof chunk.obfuscation === "string"
        ? chunk.obfuscation
        : undefined;
    const takeObfuscation = (): JsonObject => {
      if (pendingObfuscation === undefined) return {};
      const obfuscation = pendingObfuscation;
      pendingObfuscation = undefined;
      return { obfuscation };
    };
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
        const deltaLogprobs = convertTokenLogprobs(choice.logprobs, false);
        textEventLogprobs.push(...deltaLogprobs);
        textLogprobs.push(...convertTokenLogprobs(choice.logprobs, true));
        event(controller, "response.output_text.delta", {
          item_id: messageId,
          output_index: messageOutputIndex,
          content_index: 0,
          delta: choice.delta.content,
          logprobs: deltaLogprobs,
          ...takeObfuscation(),
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
              ...takeObfuscation(),
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
