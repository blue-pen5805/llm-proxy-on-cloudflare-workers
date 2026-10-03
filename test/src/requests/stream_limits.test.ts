import { describe, expect, it } from "vitest";
import {
  StreamingLimitError,
  StreamingResponseBudget,
  type StreamingResponseLimits,
} from "~/src/requests/stream_limits";

const tinyLimits: StreamingResponseLimits = {
  sseRecordBytes: 1,
  textBytes: 1,
  logprobBytes: 1,
  toolCalls: 1,
  toolArgumentBytes: 1,
  toolMetadataBytes: 1,
  outputItems: 1,
};

describe("StreamingResponseBudget", () => {
  it("tracks each streaming resource independently in UTF-8 bytes", () => {
    const budget = new StreamingResponseBudget(tinyLimits);

    expect(budget.checkSseRecord(1)).toBeUndefined();
    expect(budget.checkSseRecord(2)?.limit).toBe("sse_record_bytes");

    expect(budget.addText("a")).toBeUndefined();
    expect(budget.addText("é")?.limit).toBe("text_bytes");

    expect(budget.addLogprobs("a")).toBeUndefined();
    expect(budget.addLogprobs("é")?.limit).toBe("logprob_bytes");

    expect(budget.addTool()).toBeUndefined();
    expect(budget.addTool()?.limit).toBe("tool_calls");

    expect(budget.addToolArguments("a")).toBeUndefined();
    expect(budget.addToolArguments("b")?.limit).toBe("tool_argument_bytes");

    expect(budget.addToolMetadata("a")).toBeUndefined();
    expect(budget.addToolMetadata("b")?.limit).toBe("tool_metadata_bytes");

    expect(budget.addOutputItem()).toBeUndefined();
    expect(budget.addOutputItem()?.limit).toBe("output_items");
  });

  it("exposes a stable safe error without streamed content", () => {
    const error = new StreamingLimitError("text_bytes");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("StreamingLimitError");
    expect(error.message).toBe("Streaming text exceeds the proxy limit.");
  });
});
