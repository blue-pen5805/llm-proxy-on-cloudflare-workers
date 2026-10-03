import { expect, it, vi } from "vitest";
import { convertStreamingResponse as messagesStream } from "~/src/requests/messages/stream";
import { convertStreamingResponse as responsesStream } from "~/src/requests/responses/stream";
import {
  MAX_STREAM_TEXT_BYTES,
  MAX_STREAM_TOOL_METADATA_BYTES,
} from "~/src/requests/stream_limits";

const convert = {
  messages: (response: Response) =>
    messagesStream(
      response,
      { model: "fixture", messages: [], max_tokens: 10, stream: true },
      false,
    ),
  responses: (response: Response) =>
    responsesStream(
      response,
      { model: "fixture", input: "hello", stream: true },
      false,
    ),
};
const chunk = (delta: unknown) => ({
  choices: [{ index: 0, delta, finish_reason: null }],
});
const frames = (chunks: unknown[]) =>
  chunks.map((value) => `data: ${JSON.stringify(value)}\n\n`).join("") +
  "data: [DONE]\n\n";
const sse = (chunks: unknown[]) =>
  new Response(frames(chunks), {
    headers: { "content-type": "text/event-stream" },
  });
const events = (body: string): Record<string, unknown>[] =>
  body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)));

it.each(["messages", "responses"] as const)(
  "terminates %s output on upstream error without disclosing its payload",
  async (protocol) => {
    for (const error of [
      { error: { message: "example-sensitive-payload" } },
      {
        error: "example-sensitive-payload",
        choices: [{ delta: {}, finish_reason: "error" }],
      },
      { choices: [null, { delta: {}, finish_reason: "error" }] },
    ]) {
      const cancel = vi.fn();
      const response = new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                frames([
                  chunk({ content: "partial" }),
                  error,
                  chunk({ content: "must-not-appear" }),
                ]),
              ),
            );
          },
          cancel,
        }),
      );
      const body = await convert[protocol](response).text();
      expect(body).toContain("partial");
      expect(body).toContain("event: error");
      expect(body).toContain("Upstream Chat Completions stream failed.");
      expect(body).not.toContain("example-sensitive-payload");
      expect(body).not.toContain("must-not-appear");
      expect(body).not.toContain("event: response.completed");
      expect(body).not.toContain("event: message_stop");
      expect(cancel).toHaveBeenCalledOnce();
    }
  },
);

it("preserves Responses refusal deltas, terminal content and encounter-order indexes", async () => {
  for (const refusalFirst of [false, true]) {
    const deltas = refusalFirst
      ? [
          { refusal: "Cannot " },
          { content: "Context." },
          { refusal: "comply." },
        ]
      : [
          { content: "Context." },
          { refusal: "Cannot " },
          { refusal: "comply." },
        ];
    const body = await convert.responses(sse(deltas.map(chunk))).text();
    const parsed = events(body);
    const index = refusalFirst ? 0 : 1;
    expect(
      parsed.filter((event) => event.type === "response.refusal.delta"),
    ).toMatchObject([
      { content_index: index, delta: "Cannot " },
      { content_index: index, delta: "comply." },
    ]);
    expect(
      parsed.find((event) => event.type === "response.refusal.done"),
    ).toMatchObject({ content_index: index, refusal: "Cannot comply." });
    const text = {
      type: "output_text",
      text: "Context.",
      annotations: [],
      logprobs: [],
    };
    const refusal = { type: "refusal", refusal: "Cannot comply." };
    expect(parsed.at(-1)).toMatchObject({
      type: "response.completed",
      response: {
        output: [
          {
            type: "message",
            content: refusalFirst ? [refusal, text] : [text, refusal],
          },
        ],
      },
    });
    expect(parsed.map((event) => event.sequence_number)).toEqual(
      parsed.map((_, index) => index),
    );
  }
});

it("preserves refusal-only Responses without an invented output_text part", async () => {
  const parsed = events(
    await convert.responses(sse([chunk({ refusal: "Cannot comply." })])).text(),
  );
  expect(
    parsed.filter((event) => event.type === "response.content_part.added"),
  ).toEqual([
    expect.objectContaining({
      content_index: 0,
      part: { type: "refusal", refusal: "" },
    }),
  ]);
  expect(
    parsed.some((event) => event.type === "response.output_text.delta"),
  ).toBe(false);
  expect(parsed.at(-1)).toMatchObject({
    response: {
      output: [{ content: [{ type: "refusal", refusal: "Cannot comply." }] }],
    },
  });
});

it("preserves Messages refusal text in the streamed text block", async () => {
  const parsed = events(
    await convert
      .messages(
        sse([chunk({ refusal: "Cannot " }), chunk({ refusal: "comply." })]),
      )
      .text(),
  );
  expect(
    parsed.filter((event) => event.type === "content_block_delta"),
  ).toMatchObject([
    { index: 0, delta: { type: "text_delta", text: "Cannot " } },
    { index: 0, delta: { type: "text_delta", text: "comply." } },
  ]);
  expect(parsed.at(-1)).toMatchObject({ type: "message_stop" });
});

it.each(["messages", "responses"] as const)(
  "counts refusal bytes against the shared %s text budget",
  async (protocol) => {
    const chunks = Array.from({ length: 8 }, () =>
      chunk({ content: "x".repeat(MAX_STREAM_TEXT_BYTES / 8) }),
    );
    chunks.push(chunk({ refusal: "too much" }));
    const body = await convert[protocol](sse(chunks)).text();
    expect(body).toContain("Streaming text exceeds the proxy limit.");
    expect(body).not.toContain("event: response.completed");
    expect(body).not.toContain("event: message_stop");
  },
);

it("applies the output-item limit when a refusal starts after 64 tools", async () => {
  const tool_calls = Array.from({ length: 64 }, (_, index) => ({
    index,
    id: `call_${index}`,
    function: { name: "lookup", arguments: "{}" },
  }));
  const body = await convert
    .responses(
      sse([chunk({ tool_calls }), chunk({ refusal: "Cannot comply." })]),
    )
    .text();
  expect(body).toContain(
    "Streaming output item count exceeds the proxy limit.",
  );
  expect(body).not.toContain("event: response.completed");
});

it("bounds Messages initial IDs, names and cumulative name replacements", async () => {
  for (const calls of [
    [{ index: 0, id: "x".repeat(MAX_STREAM_TOOL_METADATA_BYTES + 1) }],
    [
      {
        index: 0,
        id: "a",
        function: { name: "x".repeat(MAX_STREAM_TOOL_METADATA_BYTES) },
      },
    ],
    [
      { index: 0, id: "a", function: { name: "lookup" } },
      {
        index: 0,
        function: { name: "x".repeat(MAX_STREAM_TOOL_METADATA_BYTES) },
      },
    ],
  ]) {
    const body = await convert
      .messages(sse(calls.map((call) => chunk({ tool_calls: [call] }))))
      .text();
    expect(body).toContain("Streaming tool metadata exceeds the proxy limit.");
    expect(body).not.toContain("event: message_stop");
  }
});

it("accepts Messages metadata at the exact byte boundary", async () => {
  const name = "x".repeat(MAX_STREAM_TOOL_METADATA_BYTES - 1);
  const body = await convert
    .messages(
      sse([
        chunk({
          tool_calls: [
            { index: 0, id: "a", function: { name, arguments: "{}" } },
          ],
        }),
      ]),
    )
    .text();
  expect(body).toContain(name);
  expect(body).toContain("event: message_stop");
  expect(body).not.toContain("event: error");
});
