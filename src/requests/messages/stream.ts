import { headersForRewrittenBody } from "../response";
import {
  createChatCompletionSseTransform,
  isJsonObject as isObject,
  type JsonObject,
} from "../sse";
import { StreamingResponseBudget } from "../stream_limits";
import type { MessagesRequest } from "./request";
import {
  convertUsage,
  convertDeltaUsage,
  invalidUpstreamResponse,
  messageId,
  stopReason,
} from "./response";

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
  let usage: JsonObject = convertDeltaUsage(undefined);
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
        container: null,
        model: request.model,
        stop_details: null,
        stop_reason: null,
        stop_sequence: null,
        usage: convertUsage(undefined),
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
      content_block: { type: "text", text: "", citations: null },
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
      delta: {
        container: null,
        stop_details: null,
        stop_reason: stopReason(finishReason),
        stop_sequence: null,
      },
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
  const processChunk = (
    chunk: JsonObject,
    controller: TransformStreamDefaultController<Uint8Array>,
  ) => {
    start(controller);
    if (responseMetadataEnabled && isObject(chunk.llm_proxy))
      proxyMetadata = chunk.llm_proxy;
    if (chunk.usage !== undefined) usage = convertDeltaUsage(chunk.usage);
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
