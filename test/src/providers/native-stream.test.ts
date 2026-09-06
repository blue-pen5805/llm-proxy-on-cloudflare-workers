import { describe, expect, it, vi } from "vitest";
import { transformNativeResponse } from "~/src/providers/native";
import { MAX_SSE_RECORD_BYTES } from "~/src/requests/stream_limits";
import { awsEvent, bytes, byteStream } from "../../helpers/aws_event_stream";

const encoder = new TextEncoder();
const start = {
  type: "message_start",
  message: {
    usage: { input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 2 },
  },
};
const finish = {
  type: "message_delta",
  delta: { stop_reason: "end_turn" },
  usage: { output_tokens: 3 },
};
const stop = { type: "message_stop" };
function sse(events: unknown[], finalSeparator = true): Uint8Array {
  return encoder.encode(
    events.map((event) => `data: ${JSON.stringify(event)}`).join("\n\n") +
      (finalSeparator ? "\n\n" : ""),
  );
}
function chunks(text: string): Record<string, any>[] {
  return text
    .split("\n\n")
    .filter((block) => block.startsWith("data: {"))
    .map((block) => JSON.parse(block.slice(6)));
}
async function messages(
  events: unknown[],
  options: Record<string, unknown> = {},
  finalSeparator = true,
) {
  const source = new Response(
    byteStream(sse(events, finalSeparator), [1, 7, 128]),
    {
      headers: {
        "content-type": "text/event-stream",
        "content-length": "999",
        "cf-aig-cache-status": "MISS",
      },
    },
  );
  return transformNativeResponse(source, "messages", "claude", options);
}
async function gemini(
  events: unknown[],
  options: Record<string, unknown> = {},
  finalSeparator = true,
) {
  return transformNativeResponse(
    new Response(byteStream(sse(events, finalSeparator)), {
      headers: { "content-type": "Text/Event-Stream" },
    }),
    "generateContent",
    "gemini",
    options,
  );
}
async function converse(
  events: [string, unknown][],
  options: Record<string, unknown> = {},
) {
  return transformNativeResponse(
    new Response(
      byteStream(
        bytes(...events.map(([type, data]) => awsEvent(type, data))),
        [7, 21, 128],
      ),
      { headers: { "content-type": "application/vnd.amazon.eventstream" } },
    ),
    "converse",
    "nova",
    options,
  );
}

describe("native inference streaming", () => {
  it("converts fragmented Messages text, tool arguments and final usage", async () => {
    const response = await messages(
      [
        start,
        { type: "ping" },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "こんにちは" },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "content_block_start",
          index: 5,
          content_block: {
            type: "tool_use",
            id: "tool-1",
            name: "weather",
            input: {},
          },
        },
        {
          type: "content_block_delta",
          index: 5,
          delta: { type: "input_json_delta", partial_json: '{"city":' },
        },
        {
          type: "content_block_delta",
          index: 5,
          delta: { type: "input_json_delta", partial_json: '"Tokyo"}' },
        },
        { ...finish, delta: { stop_reason: "tool_use" } },
        stop,
      ],
      { stream_options: { include_usage: true } },
    );
    expect(response.headers.get("content-length")).toBeNull();
    expect(response.headers.get("cf-aig-cache-status")).toBe("MISS");
    const text = await response.text();
    expect(text.endsWith("data: [DONE]\n\n")).toBe(true);
    const output = chunks(text);
    expect(output[0]).toMatchObject({
      object: "chat.completion.chunk",
      model: "claude",
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content: "" },
          finish_reason: null,
        },
      ],
    });
    expect(output[1].choices[0].delta).toEqual({ content: "こんにちは" });
    expect(output[2].choices[0].delta.tool_calls).toEqual([
      {
        index: 0,
        id: "tool-1",
        type: "function",
        function: { name: "weather", arguments: "" },
      },
    ]);
    expect(output[3].choices[0].delta.tool_calls[0]).toEqual({
      index: 0,
      function: { arguments: '{"city":' },
    });
    expect(output[4].choices[0].delta.tool_calls[0].function.arguments).toBe(
      '"Tokyo"}',
    );
    expect(output[5].choices[0].finish_reason).toBe("tool_calls");
    expect(output[6]).toMatchObject({
      choices: [],
      usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
    });
    expect(new Set(output.map((chunk) => chunk.id)).size).toBe(1);
  });

  it.each([
    {},
    { stream_options: {} },
    { stream_options: { include_usage: false } },
  ])(
    "emits Messages content at block start, handles an unterminated final record, and honors usage option %j",
    async (options) => {
      const response = await messages(
        [
          start,
          {
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "initial" },
          },
          {
            type: "content_block_start",
            index: 1,
            content_block: { type: "thinking", thinking: "private" },
          },
          {
            type: "content_block_delta",
            index: 1,
            delta: { type: "thinking_delta", thinking: "private" },
          },
          {
            type: "message_delta",
            delta: { stop_reason: null },
            usage: { output_tokens: 1 },
          },
          finish,
          stop,
        ],
        options,
        false,
      );
      const text = await response.text();
      expect(text).toContain('"content":"initial"');
      expect(text).not.toContain("private");
      expect(chunks(text).some((chunk) => "usage" in chunk)).toBe(false);
    },
  );

  it("converts interleaved Gemini candidates and gives each tool a stable output index", async () => {
    const response = await gemini(
      [
        {
          candidates: [
            { index: 0, content: { parts: [{ text: "first" }] } },
            { index: 1, content: { parts: [{ text: "second" }] } },
          ],
        },
        { candidates: [{ index: 1, finishReason: "MAX_TOKENS" }] },
        {
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: { id: "call-1", name: "f", args: {} },
                    thoughtSignature: "signature",
                  },
                ],
              },
            },
          ],
        },
        {
          candidates: [
            {
              content: {
                parts: [
                  { functionCall: { id: "call-2", name: "g", args: {} } },
                ],
              },
            },
          ],
        },
        { candidates: [{ index: 0, finishReason: "STOP" }] },
        {
          usageMetadata: {
            promptTokenCount: 12,
            candidatesTokenCount: 4,
            thoughtsTokenCount: 2,
          },
        },
      ],
      { stream_options: { include_usage: true } },
      false,
    );
    const text = await response.text();
    const output = chunks(text);
    expect(output[0].choices.map((choice: any) => choice.index)).toEqual([
      0, 1,
    ]);
    expect(output[1].choices[0].finish_reason).toBe("length");
    expect(output[2].choices[0].delta.tool_calls[0]).toMatchObject({
      index: 0,
      id: "call-1",
      extra_content: { google: { thought_signature: "signature" } },
    });
    expect(output[3].choices[0].delta.tool_calls[0]).toMatchObject({
      index: 1,
      id: "call-2",
    });
    expect(output[4].choices[0].finish_reason).toBe("tool_calls");
    expect(output[5]).toMatchObject({
      choices: [],
      usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
    });
    expect(text.endsWith("data: [DONE]\n\n")).toBe(true);
  });

  it("handles Gemini prompt blocks and non-data SSE records", async () => {
    const blocked = await gemini([
      { promptFeedback: { blockReason: "SAFETY" } },
    ]);
    expect(chunks(await blocked.text())[0].choices[0].finish_reason).toBe(
      "content_filter",
    );
    const source = new Response(
      ": keepalive\n\nevent: custom\n\ndata: " +
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: "ok" }] }, finishReason: "STOP" },
          ],
        }) +
        "\n\n",
      { headers: { "content-type": "text/event-stream" } },
    );
    expect(
      await (
        await transformNativeResponse(source, "generateContent", "g", {})
      ).text(),
    ).toContain('"content":"ok"');
  });

  it("converts AWS Converse binary frames, tool arguments and final usage to SSE", async () => {
    const response = await converse(
      [
        ["messageStart", { role: "assistant" }],
        ["contentBlockStart", { contentBlockIndex: 0, start: {} }],
        [
          "contentBlockDelta",
          { contentBlockIndex: 0, delta: { text: "hello" } },
        ],
        ["contentBlockStop", { contentBlockIndex: 0 }],
        [
          "contentBlockStart",
          {
            contentBlockIndex: 5,
            start: { toolUse: { toolUseId: "tool-1", name: "weather" } },
          },
        ],
        [
          "contentBlockDelta",
          { contentBlockIndex: 5, delta: { toolUse: { input: "{}" } } },
        ],
        ["messageStop", { stopReason: "tool_use" }],
        ["metadata", { usage: { inputTokens: 10, outputTokens: 3 } }],
      ],
      { stream_options: { include_usage: true } },
    );
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const text = await response.text();
    const output = chunks(text);
    expect(output[1].choices[0].delta).toEqual({ content: "hello" });
    expect(output[2].choices[0].delta.tool_calls[0]).toMatchObject({
      index: 0,
      id: "tool-1",
    });
    expect(output[3].choices[0].delta.tool_calls[0]).toEqual({
      index: 0,
      function: { arguments: "{}" },
    });
    expect(output[4].choices[0].finish_reason).toBe("tool_calls");
    expect(output[5]).toMatchObject({
      choices: [],
      usage: { total_tokens: 13 },
    });
    expect(text.endsWith("data: [DONE]\n\n")).toBe(true);
  });

  it.each(
    [
      [],
      [start],
      [start, finish],
      [stop],
      [{ error: { message: "provider secret detail" } }],
      [{ type: "error" }],
      [
        {
          type: "content_block_delta",
          index: 1,
          delta: { type: "input_json_delta", partial_json: "{}" },
        },
      ],
      [{ type: "content_block_delta", delta: { type: "text_delta", text: 1 } }],
    ].map((events) => ({ events })),
  )(
    "rejects incomplete or malformed Messages streams: %j",
    async ({ events }) => {
      await expect((await messages(events)).text()).rejects.toThrow();
    },
  );

  it.each([-1, "index", 0.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid native tool indexes: %s",
    async (index) => {
      await expect(
        (
          await messages([
            {
              type: "content_block_start",
              index,
              content_block: { type: "tool_use", id: "tool", name: "f" },
            },
          ])
        ).text(),
      ).rejects.toThrow("index");
    },
  );

  it("rejects repeated tool starts and tool counts exceeding the bounded state", async () => {
    const tool = {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "tool", name: "f" },
    };
    await expect((await messages([tool, tool])).text()).rejects.toThrow(
      "Duplicate",
    );
    await expect(
      (
        await messages(
          Array.from({ length: 65 }, (_, index) => ({ ...tool, index })),
        )
      ).text(),
    ).rejects.toThrow("tool call count");
    await expect(
      (
        await gemini([
          {
            candidates: [
              {
                content: {
                  parts: Array.from({ length: 65 }, () => ({
                    functionCall: { name: "f" },
                  })),
                },
                finishReason: "STOP",
              },
            ],
          },
        ])
      ).text(),
    ).rejects.toThrow("tool call count");
  });

  it("rejects an unfinished Gemini candidate and an excessive candidate index", async () => {
    await expect(
      (
        await gemini([
          {
            candidates: [
              { index: 0, finishReason: "STOP" },
              { index: 1, content: { parts: [] } },
            ],
          },
        ])
      ).text(),
    ).rejects.toThrow("terminal event");
    await expect(
      (
        await gemini([{ candidates: [{ index: 64, finishReason: "STOP" }] }])
      ).text(),
    ).rejects.toThrow("index");
    await expect((await gemini([{}])).text()).rejects.toThrow("terminal event");
  });

  it("rejects malformed JSON, invalid UTF-8 and oversized SSE records", async () => {
    for (const data of [
      encoder.encode("data: bad-json\n\n"),
      encoder.encode("data: []\n\n"),
      new Uint8Array([255]),
      encoder.encode("data: " + "x".repeat(MAX_SSE_RECORD_BYTES)),
    ]) {
      const response = await transformNativeResponse(
        new Response(byteStream(data), {
          headers: { "content-type": "text/event-stream" },
        }),
        "messages",
        "m",
        {},
      );
      await expect(response.text()).rejects.toThrow();
    }
  });

  it("fails Converse stream exceptions and missing completion events", async () => {
    await expect(
      (
        await converse([["internalServerException", { message: "private" }]])
      ).text(),
    ).rejects.toThrow("Bedrock inference stream returned an error");
    await expect(
      (await converse([["messageStart", {}]])).text(),
    ).rejects.toThrow("terminal event");
  });

  it("propagates downstream cancellation to the provider response", async () => {
    let resolveCancellation!: () => void;
    const cancelled = new Promise<void>((resolve) => {
      resolveCancellation = resolve;
    });
    const cancel = vi.fn(() => {
      resolveCancellation();
    });
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(sse([start]));
      },
      cancel,
    });
    const response = await transformNativeResponse(
      new Response(source, {
        headers: { "content-type": "text/event-stream" },
      }),
      "messages",
      "m",
      {},
    );
    const reader = response.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    await reader.cancel("client disconnected");
    await cancelled;
    expect(cancel).toHaveBeenCalledWith("client disconnected");
  });
});
