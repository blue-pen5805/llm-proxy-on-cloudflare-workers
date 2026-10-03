import { describe, expect, it, vi } from "vitest";
import {
  createChatCompletionSseTransform,
  createSseRecordTransform,
  sseData,
  sseEventType,
} from "~/src/requests/sse";
import {
  StreamingResponseBudget,
  type StreamingResponseLimits,
} from "~/src/requests/stream_limits";

const encoder = new TextEncoder();
function chunks(
  bytes: Uint8Array,
  sizes: number[],
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      let offset = 0;
      for (const size of sizes) {
        controller.enqueue(bytes.slice(offset, offset + size));
        offset += size;
      }
      controller.enqueue(bytes.slice(offset));
      controller.close();
    },
  });
}
function budget(bytes = 1024) {
  return new StreamingResponseBudget({
    sseRecordBytes: bytes,
    textBytes: 1024,
    logprobBytes: 1024,
    toolCalls: 64,
    toolArgumentBytes: 1024,
    toolMetadataBytes: 1024,
    outputItems: 64,
  } satisfies StreamingResponseLimits);
}
async function records(
  input: string,
  sizes: number[],
  maximum?: number,
  isTerminalRecord?: (block: string) => boolean,
) {
  const result: { block: string; separator: string }[] = [];
  let tail: string | undefined;
  const transform = createSseRecordTransform({
    budget: budget(maximum),
    isTerminalRecord,
    onRecord(block, separator) {
      result.push({ block, separator });
    },
    onError(error, controller) {
      controller.error(error);
    },
    onEnd(pending) {
      tail = pending;
    },
  });
  await new Response(
    chunks(encoder.encode(input), sizes).pipeThrough(transform),
  ).text();
  return { result, tail };
}

describe("SSE line state", () => {
  it.each([
    [": ping", undefined],
    ["data: invalid-json", undefined],
    ["data: null", undefined],
    ["data: []", undefined],
    ['data: {"type":123}', undefined],
    ['data: {"type":"message_stop"}', "message_stop"],
  ])(
    "probes terminal event types without replacing malformed-data errors (%j)",
    (block, expected) => {
      expect(sseEventType(block)).toBe(expected);
    },
  );

  it.each([false, true])(
    "closes an open Chat stream on a CR-only terminal record (split %s)",
    async (split) => {
      const cancel = vi.fn();
      const source = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of split
            ? ["data: [DONE]\r", "\r"]
            : ["data: [DONE]\r\r"])
            controller.enqueue(encoder.encode(chunk));
        },
        cancel,
      });
      let finished = false;
      const transform = createChatCompletionSseTransform({
        budget: budget(),
        onChunk() {
          throw new Error("Unexpected data after terminal record");
        },
        onDone(controller) {
          finished = true;
          controller.enqueue(encoder.encode("complete"));
          controller.terminate();
        },
        onError(error, controller) {
          controller.error(error);
        },
        isFinished: () => finished,
      });
      expect(await new Response(source.pipeThrough(transform)).text()).toBe(
        "complete",
      );
      await Promise.resolve();
      expect(cancel).toHaveBeenCalledOnce();
    },
  );

  it("preserves split CRLF separators when the terminal probe rejects the record", async () => {
    const input = "data: first\r\n\r\ndata: second\r\n\r\n";
    const probe = vi.fn(() => false);
    const result = await records(
      input,
      Array(input.length).fill(1),
      undefined,
      probe,
    );
    expect(result.result).toEqual([
      { block: "data: first", separator: "\r\n\r\n" },
      { block: "data: second", separator: "\r\n\r\n" },
    ]);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("rejects oversized CR-only records before probing their JSON", async () => {
    const probe = vi.fn(() => true);
    await expect(
      records('data: {"type":"message_stop"}\r\r', [], 8, probe),
    ).rejects.toThrow("Upstream SSE record exceeds the proxy limit.");
    expect(probe).not.toHaveBeenCalled();
  });

  it.each([
    ["data", ""],
    ["data:", ""],
    ["data: value", "value"],
    ["data:  value", " value"],
    ["data:\tvalue", "\tvalue"],
    ["data: \tvalue", "\tvalue"],
    ["data:\u00a0value", "\u00a0value"],
    ["data: first\ndata\ndata:  last", "first\n\n last"],
    ["metadata: ignored\n: comment", undefined],
  ])("preserves SSE data field semantics for %j", (block, expected) => {
    expect(sseData(block)).toBe(expected);
  });

  it.each(["\n", "\r\n", "\r"])(
    "preserves records and endings for %j at every byte split",
    async (ending) => {
      const block = `: comment${ending}data: {"text":${ending}data: "日本語"}`;
      const input = `${block}${ending}${ending}data: [DONE]${ending}${ending}`;
      const bytes = encoder.encode(input);
      for (let split = 0; split <= bytes.length; split++) {
        const { result, tail } = await records(input, [split]);
        expect(result).toEqual([
          { block, separator: ending + ending },
          { block: "data: [DONE]", separator: ending + ending },
        ]);
        expect(result.map(({ block }) => sseData(block))).toEqual([
          '{"text":\n"日本語"}',
          "[DONE]",
        ]);
        expect(tail).toBe("");
      }
      const oneByte = await records(input, Array(bytes.length).fill(1));
      expect(
        oneByte.result
          .map(({ block, separator }) => block + separator)
          .join(""),
      ).toBe(input);
    },
  );

  it("handles mixed endings, leading blank lines, an initial BOM, and an unterminated tail", async () => {
    const input = "\uFEFF\r\ndata: first\r\n\rdata: second\n\r\ndata: tail";
    const { result, tail } = await records(
      input,
      Array(encoder.encode(input).length).fill(1),
    );
    expect(result).toEqual([
      { block: "", separator: "\r\n" },
      { block: "data: first", separator: "\r\n\r" },
      { block: "data: second", separator: "\n\r\n" },
    ]);
    expect(tail).toBe("data: tail");
  });

  it.each(["\n", "\r\n", "\r"])(
    "applies the same exact byte limit to split %j records",
    async (ending) => {
      const block = `data: 日${ending}data: 本`;
      const maximum = encoder.encode(block).length;
      const input = block + ending + ending;
      for (let split = 0; split <= encoder.encode(input).length; split++) {
        expect((await records(input, [split], maximum)).result[0].block).toBe(
          block,
        );
        await expect(records(input, [split], maximum - 1)).rejects.toThrow(
          "Upstream SSE record exceeds the proxy limit.",
        );
      }
      await expect(records(block + ending, [], maximum - 1)).rejects.toThrow(
        "Upstream SSE record exceeds the proxy limit.",
      );
    },
  );

  it("retains a CR-terminated non-empty tail at EOF", async () => {
    expect(await records("data: tail\r", [11])).toEqual({
      result: [],
      tail: "data: tail\r",
    });
  });

  it("skips the end callback when a buffered CR-only record finishes at EOF", async () => {
    let finished = false;
    const onEnd = vi.fn();
    const onRecord = vi.fn((block: string, separator: string) => {
      expect(block).toBe("data: final");
      expect(separator).toBe("\r\r");
      finished = true;
    });
    const transform = createSseRecordTransform({
      budget: budget(),
      onRecord,
      onEnd,
      onError(error, controller) {
        controller.error(error);
      },
      isFinished: () => finished,
    });
    await new Response(
      new Response("data: final\r\r").body!.pipeThrough(transform),
    ).text();
    expect(onRecord).toHaveBeenCalledOnce();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("dispatches a CR-only terminal event at EOF without a false truncation error", async () => {
    let done = false;
    const transform = createChatCompletionSseTransform({
      budget: budget(),
      onChunk() {
        throw new Error("Unexpected chunk");
      },
      onDone() {
        done = true;
      },
      onError(error, controller) {
        controller.error(error);
      },
      isFinished: () => done,
    });
    await new Response(
      new Response("data: [DONE]\r\r").body!.pipeThrough(transform),
    ).text();
    expect(done).toBe(true);
  });
});
