import { headersForRewrittenBody } from "../requests/response";
import {
  createSseRecordTransform,
  sseData,
  type JsonObject,
} from "../requests/sse";
import { StreamingResponseBudget } from "../requests/stream_limits";
import { nativeObject } from "./native_response";
import {
  responsesFinishReason,
  responsesText,
  responsesUsage,
} from "./responses_response";

type Controller = TransformStreamDefaultController<Uint8Array>;

function outputIndex(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("Invalid Responses output index.");
  }
  return value;
}

/** Converts deltas without retaining generated content or argument strings. */
export function responsesStream(
  response: Response,
  body: ReadableStream<Uint8Array>,
  model: string,
  includeUsage: boolean,
): Response {
  const encoder = new TextEncoder();
  const budget = new StreamingResponseBudget();
  const tools = new Map<number, number>();
  const id = `chatcmpl_${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  let finished = false;
  let started = false;
  const emit = (
    controller: Controller,
    choices: JsonObject[],
    usage?: JsonObject,
  ) => {
    controller.enqueue(
      encoder.encode(
        `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices, ...(usage ? { usage } : {}) })}\n\n`,
      ),
    );
  };
  const delta = (
    controller: Controller,
    value: JsonObject,
    finishReason: string | null = null,
  ) => {
    if (!started) {
      started = true;
      emit(controller, [
        {
          index: 0,
          delta: { role: "assistant", content: "" },
          finish_reason: null,
        },
      ]);
    }
    emit(controller, [{ index: 0, delta: value, finish_reason: finishReason }]);
  };
  const process = (block: string, controller: Controller) => {
    const data = sseData(block);
    if (data === undefined) return;
    const event = nativeObject(JSON.parse(data));
    if (event.type === "error" || event.type === "response.failed")
      throw new Error("Upstream Responses stream failed.");
    if (event.type === "response.output_text.delta")
      delta(controller, { content: responsesText(event.delta) });
    else if (event.type === "response.refusal.delta")
      delta(controller, { refusal: responsesText(event.delta) });
    else if (event.type === "response.output_item.added") {
      const item = nativeObject(event.item);
      if (item.type === "function_call") {
        const index = outputIndex(event.output_index);
        if (tools.has(index))
          throw new Error("Duplicate Responses tool start.");
        const limit = budget.addTool();
        if (limit) throw limit;
        const toolIndex = tools.size;
        tools.set(index, toolIndex);
        delta(controller, {
          tool_calls: [
            {
              index: toolIndex,
              id: responsesText(item.call_id),
              type: "function",
              function: {
                name: responsesText(item.name),
                arguments: responsesText(item.arguments),
              },
            },
          ],
        });
      }
    } else if (event.type === "response.function_call_arguments.delta") {
      const index = tools.get(outputIndex(event.output_index));
      if (index === undefined)
        throw new Error("Responses tool delta has no start event.");
      delta(controller, {
        tool_calls: [
          { index, function: { arguments: responsesText(event.delta) } },
        ],
      });
    } else if (
      event.type === "response.completed" ||
      event.type === "response.incomplete"
    ) {
      const result = nativeObject(event.response);
      delta(controller, {}, responsesFinishReason(result, tools.size > 0));
      if (includeUsage) emit(controller, [], responsesUsage(result.usage));
      finished = true;
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.terminate();
    }
  };
  const transform = createSseRecordTransform({
    budget,
    onRecord(block, _separator, controller) {
      process(block, controller);
    },
    onError(error, controller) {
      controller.error(error);
    },
    onEnd(pending, controller) {
      if (pending.trim()) process(pending, controller);
      if (!finished)
        throw new Error("Responses stream ended without a terminal event.");
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
