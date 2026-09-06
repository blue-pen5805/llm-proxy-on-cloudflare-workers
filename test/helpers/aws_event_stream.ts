/** Independent bitwise CRC implementation for constructing protocol fixtures. */
export function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

export function bytes(...values: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    values.reduce((size, value) => size + value.length, 0),
  );
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.length;
  }
  return result;
}

export function awsHeader(
  name: string,
  kind: number,
  value: Uint8Array = new Uint8Array(),
): Uint8Array {
  const encodedName = new TextEncoder().encode(name);
  const prefix = new Uint8Array(kind === 6 || kind === 7 ? 2 : 0);
  if (prefix.length) new DataView(prefix.buffer).setUint16(0, value.length);
  return bytes(
    new Uint8Array([encodedName.length]),
    encodedName,
    new Uint8Array([kind]),
    prefix,
    value,
  );
}

export function awsFrame(headers: Uint8Array, payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(16 + headers.length + payload.length);
  const view = new DataView(frame.buffer);
  view.setUint32(0, frame.length);
  view.setUint32(4, headers.length);
  view.setUint32(8, crc32(frame.subarray(0, 8)));
  frame.set(headers, 12);
  frame.set(payload, 12 + headers.length);
  view.setUint32(frame.length - 4, crc32(frame.subarray(0, frame.length - 4)));
  return frame;
}

export function awsEvent(
  type: string,
  data: unknown,
  extras: Uint8Array = new Uint8Array(),
): Uint8Array {
  const encode = (text: string) => new TextEncoder().encode(text);
  return awsFrame(
    bytes(
      awsHeader(":message-type", 7, encode("event")),
      awsHeader(":event-type", 7, encode(type)),
      awsHeader(":content-type", 7, encode("application/json")),
      extras,
    ),
    encode(JSON.stringify(data)),
  );
}

export function byteStream(
  data: Uint8Array,
  sizes: number[] = [data.length],
): ReadableStream<Uint8Array> {
  let offset = 0;
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset === data.length) {
        controller.close();
        return;
      }
      const size = sizes[index++ % sizes.length];
      controller.enqueue(data.subarray(offset, offset + size));
      offset = Math.min(data.length, offset + size);
    },
  });
}
