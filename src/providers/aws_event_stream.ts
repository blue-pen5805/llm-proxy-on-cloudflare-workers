import type { JsonObject } from "../requests/sse";
import { MAX_SSE_RECORD_BYTES } from "../requests/stream_limits";
import { nativeObject } from "./native_response";

// Immutable lookup data for the CRC32 checks required by AWS event framing.
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++)
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

type Controller = TransformStreamDefaultController<Uint8Array>;

/** Decode bounded, checksummed AWS frames without accumulating the response. */
export function createAwsEventTransform(
  onEvent: (type: string, data: JsonObject, controller: Controller) => void,
  onEnd: (controller: Controller) => void,
): TransformStream<Uint8Array, Uint8Array> {
  let buffer = new Uint8Array(12);
  let filled = 0;
  let expected = 12;
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  const invalid = (): never => {
    throw new Error("Invalid AWS inference event stream.");
  };
  const processFrame = (frame: Uint8Array, controller: Controller) => {
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    if (
      crc32(frame.subarray(0, frame.length - 4)) !==
      view.getUint32(frame.length - 4)
    )
      return invalid();
    const headerEnd = 12 + view.getUint32(4);
    let offset = 12;
    let type = "";
    let messageType = "";
    while (offset < headerEnd) {
      const nameLength = frame[offset++]!;
      if (nameLength === 0 || offset + nameLength + 1 > headerEnd)
        return invalid();
      const name = decoder.decode(frame.subarray(offset, offset + nameLength));
      offset += nameLength;
      const kind = frame[offset++]!;
      let length: number;
      if (kind === 6 || kind === 7) {
        if (offset + 2 > headerEnd) return invalid();
        length = view.getUint16(offset);
        offset += 2;
      } else {
        const fixed = [0, 0, 1, 2, 4, 8, 0, 0, 8, 16][kind];
        if (fixed === undefined) return invalid();
        length = fixed;
      }
      if (offset + length > headerEnd) return invalid();
      if (kind === 7) {
        if (name === ":event-type")
          type = decoder.decode(frame.subarray(offset, offset + length));
        if (name === ":message-type")
          messageType = decoder.decode(frame.subarray(offset, offset + length));
      }
      offset += length;
    }
    if (messageType !== "event" || !type) return invalid();
    onEvent(
      type,
      nativeObject(
        JSON.parse(decoder.decode(frame.subarray(headerEnd, frame.length - 4))),
      ),
      controller,
    );
  };
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      let offset = 0;
      while (offset < chunk.length) {
        const take = Math.min(expected - filled, chunk.length - offset);
        buffer.set(chunk.subarray(offset, offset + take), filled);
        filled += take;
        offset += take;
        if (filled !== expected) continue;
        if (expected === 12) {
          const view = new DataView(buffer.buffer);
          const total = view.getUint32(0);
          if (
            total < 16 ||
            total > MAX_SSE_RECORD_BYTES ||
            view.getUint32(4) > total - 16 ||
            crc32(buffer.subarray(0, 8)) !== view.getUint32(8)
          )
            return invalid();
          if (buffer.length < total) {
            const expanded = new Uint8Array(total);
            expanded.set(buffer.subarray(0, 12));
            buffer = expanded;
          }
          expected = total;
        } else {
          processFrame(buffer.subarray(0, expected), controller);
          filled = 0;
          expected = 12;
        }
      }
    },
    flush(controller) {
      if (filled !== 0) return invalid();
      onEnd(controller);
    },
  });
}
