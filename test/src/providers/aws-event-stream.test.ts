import { describe, expect, it, vi } from "vitest";
import { createAwsEventTransform } from "~/src/providers/aws_event_stream";
import { MAX_SSE_RECORD_BYTES } from "~/src/requests/stream_limits";
import {
  awsEvent,
  awsFrame,
  awsHeader,
  bytes,
  byteStream,
  crc32,
} from "../../helpers/aws_event_stream";

const encoder = new TextEncoder();
const headers = bytes(
  awsHeader(":message-type", 7, encoder.encode("event")),
  awsHeader(":event-type", 7, encoder.encode("text")),
);
async function decode(data: Uint8Array, sizes?: number[]) {
  const events: unknown[] = [];
  const ended = vi.fn();
  await new Response(
    byteStream(data, sizes).pipeThrough(
      createAwsEventTransform((type, event) => {
        events.push([type, event]);
      }, ended),
    ),
  ).text();
  expect(ended).toHaveBeenCalledOnce();
  return events;
}

describe("AWS inference event framing", () => {
  it("decodes fragmented UTF-8 events and reuses a larger frame buffer", async () => {
    const data = bytes(
      awsEvent("text", { text: "こんにちは" }),
      awsEvent("end", {}),
    );
    expect(await decode(data, [1, 2, 7, 16])).toEqual([
      ["text", { text: "こんにちは" }],
      ["end", {}],
    ]);
    expect(await decode(data)).toEqual([
      ["text", { text: "こんにちは" }],
      ["end", {}],
    ]);
  });

  it("skips every defined metadata header kind", async () => {
    const extras = bytes(
      ...[0, 0, 1, 2, 4, 8, 3, 3, 8, 16].map((size, kind) =>
        awsHeader(`field-${kind}`, kind, new Uint8Array(size)),
      ),
    );
    expect(await decode(awsEvent("text", { text: "ok" }, extras))).toEqual([
      ["text", { text: "ok" }],
    ]);
  });

  it("accepts empty streams and empty transport chunks", async () => {
    expect(await decode(new Uint8Array())).toEqual([]);
    const transform = createAwsEventTransform(
      () => {},
      () => {},
    );
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array());
        controller.close();
      },
    });
    expect(await new Response(source.pipeThrough(transform)).text()).toBe("");
  });

  it.each(["prelude", "message"])(
    "rejects a corrupt %s CRC",
    async (section) => {
      const data = awsEvent("text", { text: "ok" });
      data[section === "prelude" ? 8 : data.length - 1] ^= 1;
      await expect(decode(data)).rejects.toThrow("Invalid AWS");
    },
  );

  it.each([0, 15, MAX_SSE_RECORD_BYTES + 1])(
    "rejects an invalid or oversized frame length %i before allocating it",
    async (size) => {
      const data = awsEvent("text", {});
      const view = new DataView(data.buffer);
      view.setUint32(0, size);
      view.setUint32(8, crc32(data.subarray(0, 8)));
      await expect(decode(data)).rejects.toThrow("Invalid AWS");
    },
  );

  it("rejects headers extending beyond the frame", async () => {
    const data = awsEvent("text", {});
    const view = new DataView(data.buffer);
    view.setUint32(4, data.length);
    view.setUint32(8, crc32(data.subarray(0, 8)));
    await expect(decode(data)).rejects.toThrow("Invalid AWS");
  });

  it.each([
    new Uint8Array([0, 0]),
    new Uint8Array([255]),
    new Uint8Array([1, 120, 7]),
    new Uint8Array([1, 120, 7, 0, 5]),
    new Uint8Array([1, 120, 10]),
  ])("rejects malformed event headers %j", async (extra) => {
    await expect(
      decode(awsFrame(bytes(headers, extra), encoder.encode("{}"))),
    ).rejects.toThrow("Invalid AWS");
  });

  it("rejects missing event types, upstream exceptions, invalid JSON and partial final frames", async () => {
    await expect(
      decode(awsFrame(new Uint8Array(), encoder.encode("{}"))),
    ).rejects.toThrow("Invalid AWS");
    const exception = bytes(
      awsHeader(":message-type", 7, encoder.encode("exception")),
      awsHeader(":event-type", 7, encoder.encode("internalServerException")),
    );
    await expect(
      decode(
        awsFrame(
          exception,
          encoder.encode('{"message":"private provider detail"}'),
        ),
      ),
    ).rejects.toThrow("Invalid AWS");
    await expect(
      decode(awsFrame(headers, encoder.encode("bad-json"))),
    ).rejects.toThrow();
    await expect(
      decode(awsFrame(headers, encoder.encode("null"))),
    ).rejects.toThrow("object");
    await expect(decode(awsEvent("text", {}).subarray(0, 8))).rejects.toThrow(
      "Invalid AWS",
    );
    await expect(decode(awsEvent("text", {}).subarray(0, 20))).rejects.toThrow(
      "Invalid AWS",
    );
  });
});
