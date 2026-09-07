import { utf8ByteLength } from "../utils/helpers";
import { StreamingResponseBudget } from "./stream_limits";

export type JsonObject = Record<string, unknown>;

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
 * Split SSE records with line state for LF, CRLF, and CR. A trailing CR is
 * held until the next chunk (or EOF) so split CRLF stays one line ending.
 * Scan each decoded character once and retain the original line endings for
 * callers that enrich otherwise unchanged SSE records.
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
  const lineEnding = /[\r\n]/g;
  let pending = "";
  let pendingBytes = 0;
  let scanFrom = 0;
  let lineStart = 0;
  let lastLineEnd = 0;

  const append = (decoded: string) => {
    pending += decoded;
    // Count decoded bytes: a stripped BOM is not record data, and a partial
    // UTF-8 character occupies at most three bytes inside TextDecoder.
    pendingBytes += utf8ByteLength(decoded);
  };

  const processLines = (
    controller: TransformStreamDefaultController<Uint8Array>,
    endOfStream: boolean,
  ): boolean => {
    while (scanFrom < pending.length) {
      lineEnding.lastIndex = scanFrom;
      const match = lineEnding.exec(pending);
      if (!match) {
        scanFrom = pending.length;
        break;
      }
      const position = match.index;
      const isCr = pending[position] === "\r";
      scanFrom = position;
      if (isCr && position + 1 === pending.length && !endOfStream) break;
      const end = position + (isCr && pending[position + 1] === "\n" ? 2 : 1);
      if (position === lineStart) {
        const block = pending.slice(0, lastLineEnd);
        const separator = pending.slice(lastLineEnd, end);
        const blockBytes = utf8ByteLength(block);
        pendingBytes -= blockBytes + separator.length;
        pending = pending.slice(end);
        scanFrom = lineStart = lastLineEnd = 0;
        const limitError = budget.checkSseRecord(blockBytes);
        if (limitError) {
          onError(limitError, controller);
          return false;
        }
        onRecord(block, separator, controller);
        if (isFinished()) return false;
      } else {
        lastLineEnd = position;
        scanFrom = lineStart = end;
      }
    }

    // Exclude trailing line endings that may form the record separator. This
    // keeps the record limit identical for whole and arbitrarily split input.
    let recordBytes = pendingBytes;
    if (lineStart === pending.length) {
      recordBytes -= pending.length - lastLineEnd;
    } else if (pending.endsWith("\r")) {
      recordBytes -= scanFrom === lineStart ? pending.length - lastLineEnd : 1;
    }
    const limitError = budget.checkSseRecord(recordBytes);
    if (limitError) {
      onError(limitError, controller);
      return false;
    }
    return true;
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      try {
        append(decoder.decode(chunk, { stream: true }));
      } catch {
        onError(
          new Error("Upstream returned invalid UTF-8 in an SSE record."),
          controller,
        );
        return;
      }
      processLines(controller, false);
    },
    flush(controller) {
      try {
        append(decoder.decode());
      } catch {
        onError(
          new Error("Upstream returned invalid UTF-8 in an SSE record."),
          controller,
        );
        return;
      }
      if (processLines(controller, true)) onEnd(pending, controller);
    },
  });
}

export function sseData(block: string): string | undefined {
  let data: string | undefined;
  for (const line of block.split(/\r\n|[\r\n]/)) {
    if (!line.startsWith("data:")) continue;
    const value = line.slice(5).trimStart();
    data = data === undefined ? value : `${data}\n${value}`;
  }
  return data;
}

interface ChatCompletionSseTransformOptions {
  budget: StreamingResponseBudget;
  onChunk: (
    chunk: JsonObject,
    controller: TransformStreamDefaultController<Uint8Array>,
  ) => void;
  onDone: (controller: TransformStreamDefaultController<Uint8Array>) => void;
  onError: (
    error: Error,
    controller: TransformStreamDefaultController<Uint8Array>,
  ) => void;
  isFinished: () => boolean;
}

/**
 * Decode bounded Chat Completions SSE records while leaving protocol-specific
 * output generation to the caller.
 */
export function createChatCompletionSseTransform({
  budget,
  onChunk,
  onDone,
  onError,
  isFinished,
}: ChatCompletionSseTransformOptions): TransformStream<Uint8Array, Uint8Array> {
  const processData = (
    data: string,
    controller: TransformStreamDefaultController<Uint8Array>,
  ): void => {
    if (data === "[DONE]") {
      onDone(controller);
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(data) as unknown;
    } catch {
      onError(
        new Error("Upstream returned an invalid streaming chunk."),
        controller,
      );
      return;
    }
    if (isJsonObject(parsed)) onChunk(parsed, controller);
  };

  return createSseRecordTransform({
    budget,
    onRecord(block, _separator, controller) {
      const data = sseData(block);
      if (data !== undefined) processData(data, controller);
    },
    onError,
    onEnd(pending, controller) {
      if (pending.trim()) {
        const data = sseData(pending);
        if (data !== undefined) processData(data, controller);
      }
      if (isFinished()) return;
      onError(
        new Error("Upstream stream ended without a terminal event."),
        controller,
      );
    },
    isFinished,
  });
}
