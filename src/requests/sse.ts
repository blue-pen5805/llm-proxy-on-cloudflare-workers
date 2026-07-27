import { utf8ByteLength } from "../utils/helpers";
import { StreamingResponseBudget } from "./stream_limits";

interface SseRecordTransformOptions {
  budget: StreamingResponseBudget;
  onRecord: (
    block: string,
    separator: string,
    controller: TransformStreamDefaultController<Uint8Array>,
  ) => void;
  onError: (
    error: Error,
    controller: TransformStreamDefaultController<Uint8Array>,
  ) => void;
  onEnd: (
    pending: string,
    controller: TransformStreamDefaultController<Uint8Array>,
  ) => void;
  isFinished?: () => boolean;
}

/**
 * Incrementally splits a UTF-8 SSE byte stream into records.
 *
 * The retained search offset prevents rescanning an incomplete record from its
 * beginning for every network chunk. At most the final three characters are
 * revisited because an SSE separator is at most four characters long.
 */
export function createSseRecordTransform({
  budget,
  onRecord,
  onError,
  onEnd,
  isFinished = () => false,
}: SseRecordTransformOptions): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: false,
  });
  const separatorPattern = /\r?\n\r?\n/g;
  let pending = "";
  let pendingBytes = 0;
  let searchFrom = 0;

  const fail = (
    controller: TransformStreamDefaultController<Uint8Array>,
    error: Error,
  ): void => {
    onError(error, controller);
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      pendingBytes += chunk.byteLength;
      try {
        pending += decoder.decode(chunk, { stream: true });
      } catch {
        fail(
          controller,
          new Error("Upstream returned invalid UTF-8 in an SSE record."),
        );
        return;
      }

      for (;;) {
        separatorPattern.lastIndex = searchFrom;
        const match = separatorPattern.exec(pending);
        if (!match) {
          searchFrom = Math.max(0, pending.length - 3);
          break;
        }
        const block = pending.slice(0, match.index);
        const separator = match[0];
        pending = pending.slice(match.index + separator.length);
        searchFrom = 0;
        const blockBytes = utf8ByteLength(block);
        pendingBytes -= blockBytes + utf8ByteLength(separator);
        const limitError = budget.checkSseRecord(blockBytes);
        if (limitError) {
          fail(controller, limitError);
          return;
        }
        onRecord(block, separator, controller);
        if (isFinished()) return;
      }

      const limitError = budget.checkSseRecord(pendingBytes);
      if (limitError) fail(controller, limitError);
    },
    flush(controller) {
      try {
        pending += decoder.decode();
      } catch {
        fail(
          controller,
          new Error("Upstream returned invalid UTF-8 in an SSE record."),
        );
        return;
      }
      onEnd(pending, controller);
    },
  });
}

export function sseData(block: string): string | undefined {
  let data: string | undefined;
  for (const line of block.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const value = line.slice(5).trimStart();
    data = data === undefined ? value : `${data}\n${value}`;
  }
  return data;
}
