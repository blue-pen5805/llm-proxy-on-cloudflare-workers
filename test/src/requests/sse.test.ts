import { describe, expect, it } from "vitest";
import {
  createChatCompletionSseTransform,
  createSseRecordTransform,
  sseData,
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
async function records(input: string, sizes: number[], maximum?: number) {
  const result: { block: string; separator: string }[] = [];
  let tail: string | undefined;
  const transform = createSseRecordTransform({
    budget: budget(maximum),
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
