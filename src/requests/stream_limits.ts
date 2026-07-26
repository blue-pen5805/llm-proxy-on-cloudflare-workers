import { utf8ByteLength } from "../utils/helpers";

/**
 * Converted streams may briefly hold the retained content, terminal event JSON,
 * and encoded output at the same time. These budgets keep that amplification
 * comfortably below the Workers 128 MiB isolate limit, leaving room for the
 * runtime, concurrent requests, provider state, and request conversion.
 */
export const MAX_SSE_RECORD_BYTES = 1 * 1024 * 1024;
export const MAX_STREAM_TEXT_BYTES = 4 * 1024 * 1024;
export const MAX_STREAM_TOOL_CALLS = 64;
export const MAX_STREAM_TOOL_ARGUMENT_BYTES = 4 * 1024 * 1024;
export const MAX_STREAM_TOOL_METADATA_BYTES = 64 * 1024;
export const MAX_STREAM_OUTPUT_ITEMS = 64;

export type StreamingLimit =
  | "sse_record_bytes"
  | "text_bytes"
  | "tool_calls"
  | "tool_argument_bytes"
  | "tool_metadata_bytes"
  | "output_items";

const LIMIT_MESSAGES: Record<StreamingLimit, string> = {
  sse_record_bytes: "Upstream SSE record exceeds the proxy limit.",
  text_bytes: "Streaming text exceeds the proxy limit.",
  tool_calls: "Streaming tool call count exceeds the proxy limit.",
  tool_argument_bytes: "Streaming tool arguments exceed the proxy limit.",
  tool_metadata_bytes: "Streaming tool metadata exceeds the proxy limit.",
  output_items: "Streaming output item count exceeds the proxy limit.",
};

export class StreamingLimitError extends Error {
  constructor(public readonly limit: StreamingLimit) {
    super(LIMIT_MESSAGES[limit]);
    this.name = "StreamingLimitError";
  }
}

export interface StreamingResponseLimits {
  sseRecordBytes: number;
  textBytes: number;
  toolCalls: number;
  toolArgumentBytes: number;
  toolMetadataBytes: number;
  outputItems: number;
}

const DEFAULT_STREAMING_LIMITS: StreamingResponseLimits = {
  sseRecordBytes: MAX_SSE_RECORD_BYTES,
  textBytes: MAX_STREAM_TEXT_BYTES,
  toolCalls: MAX_STREAM_TOOL_CALLS,
  toolArgumentBytes: MAX_STREAM_TOOL_ARGUMENT_BYTES,
  toolMetadataBytes: MAX_STREAM_TOOL_METADATA_BYTES,
  outputItems: MAX_STREAM_OUTPUT_ITEMS,
};

export class StreamingResponseBudget {
  private textBytes = 0;
  private toolCalls = 0;
  private toolArgumentBytes = 0;
  private toolMetadataBytes = 0;
  private outputItems = 0;

  constructor(
    private readonly limits: StreamingResponseLimits = DEFAULT_STREAMING_LIMITS,
  ) {}

  checkSseRecord(bytes: number): StreamingLimitError | undefined {
    if (bytes > this.limits.sseRecordBytes) {
      return new StreamingLimitError("sse_record_bytes");
    }
  }

  addText(text: string): StreamingLimitError | undefined {
    this.textBytes += utf8ByteLength(text);
    if (this.textBytes > this.limits.textBytes) {
      return new StreamingLimitError("text_bytes");
    }
  }

  addTool(): StreamingLimitError | undefined {
    this.toolCalls += 1;
    if (this.toolCalls > this.limits.toolCalls) {
      return new StreamingLimitError("tool_calls");
    }
  }

  addToolArguments(argumentsDelta: string): StreamingLimitError | undefined {
    this.toolArgumentBytes += utf8ByteLength(argumentsDelta);
    if (this.toolArgumentBytes > this.limits.toolArgumentBytes) {
      return new StreamingLimitError("tool_argument_bytes");
    }
  }

  addToolMetadata(metadata: string): StreamingLimitError | undefined {
    this.toolMetadataBytes += utf8ByteLength(metadata);
    if (this.toolMetadataBytes > this.limits.toolMetadataBytes) {
      return new StreamingLimitError("tool_metadata_bytes");
    }
  }

  addOutputItem(): StreamingLimitError | undefined {
    this.outputItems += 1;
    if (this.outputItems > this.limits.outputItems) {
      return new StreamingLimitError("output_items");
    }
  }
}
