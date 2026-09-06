import { headersForRewrittenBody } from "../requests/response";
import {
  createSseRecordTransform,
  isJsonObject,
  sseData,
  type JsonObject,
} from "../requests/sse";
import { StreamingResponseBudget } from "../requests/stream_limits";
import { createAwsEventTransform } from "./aws_event_stream";
import type { NativeProtocol } from "./native_request";
import {
  nativeFinishReason,
  nativeMessage,
  nativeObject,
  nativeObjects,
  nativeUsage,
} from "./native_response";

type Controller = TransformStreamDefaultController<Uint8Array>;

function validIndex(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maximum
  )
    throw new Error("Invalid native stream index.");
  return value;
}

function deltaText(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid native text delta.");
  return value;
}

/** Only frame data and bounded tool/candidate indexes are retained between chunks. */
export function nativeStream(
  response: Response,
  body: ReadableStream<Uint8Array>,
  protocol: NativeProtocol,
  model: string,
  includeUsage: boolean,
): Response {
  const encoder = new TextEncoder();
  const id = `chatcmpl_${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const budget = new StreamingResponseBudget();
  const toolIndexes = new Map<number, number>();
  const candidateTools = new Map<number, number>();
  const pendingCandidates = new Set<number>();
  let finished = false;
  let sawFinishReason = false;
  let tokens: JsonObject = {};
  const emit = (
    controller: Controller,
    choices: JsonObject[],
    usage?: JsonObject,
  ) =>
    controller.enqueue(
      encoder.encode(
        `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices, ...(usage ? { usage } : {}) })}\n\n`,
      ),
    );
  const delta = (
    controller: Controller,
    value: JsonObject,
    finishReason: string | null = null,
  ) =>
    emit(controller, [{ index: 0, delta: value, finish_reason: finishReason }]);
  const done = (controller: Controller) => {
    if (includeUsage) emit(controller, [], nativeUsage(tokens, protocol));
    finished = true;
    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    controller.terminate();
  };
  const beginTool = (
    index: unknown,
    tool: JsonObject,
    controller: Controller,
  ) => {
    const blockIndex = validIndex(index);
    if (toolIndexes.has(blockIndex))
      throw new Error("Duplicate native tool start event.");
    const limit = budget.addTool();
    if (limit) throw limit;
    const toolIndex = toolIndexes.size;
    toolIndexes.set(blockIndex, toolIndex);
    delta(controller, {
      tool_calls: [
        {
          index: toolIndex,
          id: tool.id ?? tool.toolUseId,
          type: "function",
          function: { name: tool.name, arguments: "" },
        },
      ],
    });
  };
  const toolDelta = (index: unknown, args: unknown, controller: Controller) => {
    const toolIndex = toolIndexes.get(validIndex(index));
    if (toolIndex === undefined)
      throw new Error("Tool delta has no start event.");
    delta(controller, {
      tool_calls: [
        { index: toolIndex, function: { arguments: deltaText(args) } },
      ],
    });
  };
  const processMessages = (event: JsonObject, controller: Controller) => {
    if (event.type === "message_start") {
      tokens = nativeObject(nativeObject(event.message).usage);
      delta(controller, { role: "assistant", content: "" });
    } else if (event.type === "content_block_start") {
      const part = nativeObject(event.content_block);
      if (part.type === "tool_use") beginTool(event.index, part, controller);
      else if (part.type === "text" && part.text)
        delta(controller, { content: deltaText(part.text) });
    } else if (event.type === "content_block_delta") {
      const part = nativeObject(event.delta);
      if (part.type === "text_delta")
        delta(controller, { content: deltaText(part.text) });
      else if (part.type === "input_json_delta")
        toolDelta(event.index, part.partial_json, controller);
    } else if (event.type === "message_delta") {
      const reason = nativeObject(event.delta).stop_reason;
      tokens = { ...tokens, ...nativeObject(event.usage) };
      if (reason != null) {
        sawFinishReason = true;
        delta(controller, {}, nativeFinishReason(reason));
      }
    } else if (event.type === "message_stop") {
      if (!sawFinishReason)
        throw new Error("Stream ended without a finish reason.");
      done(controller);
    }
  };
  const processGemini = (event: JsonObject, controller: Controller) => {
    if (event.usageMetadata !== undefined)
      tokens = nativeObject(event.usageMetadata);
    if (
      isJsonObject(event.promptFeedback) &&
      event.promptFeedback.blockReason
    ) {
      sawFinishReason = true;
      delta(controller, { role: "assistant", content: null }, "content_filter");
    }
    if (event.candidates === undefined) return;
    const choices = nativeObjects(event.candidates).map((candidate, index) => {
      const choiceIndex = validIndex(candidate.index ?? index, 63);
      const message = nativeMessage(
        nativeObjects(nativeObject(candidate.content ?? { parts: [] }).parts),
        protocol,
      );
      if (message.tool_calls) {
        message.tool_calls = nativeObjects(message.tool_calls).map((call) => {
          const limit = budget.addTool();
          if (limit) throw limit;
          const toolIndex = candidateTools.get(choiceIndex) ?? 0;
          candidateTools.set(choiceIndex, toolIndex + 1);
          return { ...call, index: toolIndex };
        });
      }
      const terminal = candidate.finishReason !== undefined;
      if (terminal) {
        sawFinishReason = true;
        pendingCandidates.delete(choiceIndex);
      } else {
        pendingCandidates.add(choiceIndex);
      }
      return {
        index: choiceIndex,
        delta: message,
        finish_reason: terminal
          ? candidateTools.has(choiceIndex)
            ? "tool_calls"
            : nativeFinishReason(candidate.finishReason)
          : null,
      };
    });
    emit(controller, choices);
  };
  const processConverse = (
    type: string,
    event: JsonObject,
    controller: Controller,
  ) => {
    if (type.endsWith("Exception"))
      throw new Error("Bedrock inference stream returned an error.");
    if (type === "messageStart")
      delta(controller, { role: "assistant", content: "" });
    else if (type === "contentBlockStart") {
      const start = nativeObject(event.start);
      if (start.toolUse !== undefined)
        beginTool(
          event.contentBlockIndex,
          nativeObject(start.toolUse),
          controller,
        );
    } else if (type === "contentBlockDelta") {
      const part = nativeObject(event.delta);
      if (part.text !== undefined)
        delta(controller, { content: deltaText(part.text) });
      if (part.toolUse !== undefined)
        toolDelta(
          event.contentBlockIndex,
          nativeObject(part.toolUse).input,
          controller,
        );
    } else if (type === "messageStop") {
      sawFinishReason = true;
      delta(controller, {}, nativeFinishReason(event.stopReason));
    } else if (type === "metadata") {
      tokens = nativeObject(event.usage);
    }
  };
  const end = (controller: Controller) => {
    if (
      !sawFinishReason ||
      pendingCandidates.size > 0 ||
      protocol === "messages"
    )
      throw new Error(
        "Native inference stream ended without a terminal event.",
      );
    done(controller);
  };
  const processSse = (block: string, controller: Controller) => {
    const data = sseData(block);
    if (data === undefined) return;
    const event = nativeObject(JSON.parse(data));
    if (event.error || event.type === "error")
      throw new Error("Native inference stream returned an error.");
    if (protocol === "messages") processMessages(event, controller);
    else processGemini(event, controller);
  };
  const transform =
    protocol === "converse"
      ? createAwsEventTransform(processConverse, end)
      : createSseRecordTransform({
          budget,
          onRecord(block, _separator, controller) {
            processSse(block, controller);
          },
          onError(error, controller) {
            controller.error(error);
          },
          onEnd(pending, controller) {
            if (pending.trim()) processSse(pending, controller);
            if (!finished) end(controller);
          },
          isFinished: () => finished,
        });
  const headers = headersForRewrittenBody(response.headers);
  headers.set("content-type", "text/event-stream");
  return new Response(body.pipeThrough(transform), {
    status: response.status,
    headers,
  });
}
