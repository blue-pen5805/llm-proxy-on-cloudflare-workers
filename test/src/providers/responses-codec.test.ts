import { describe, expect, it, vi } from "vitest";
import { responsesEndpoint } from "~/src/providers/responses";
import { prepareResponsesRequest } from "~/src/providers/responses_request";
import {
  convertResponsesJson,
  responsesFinishReason,
  responsesUsage,
} from "~/src/providers/responses_response";
import { responsesStream } from "~/src/providers/responses_stream";
import { MAX_SSE_RECORD_BYTES } from "~/src/requests/stream_limits";
import { opencodeChatRequest, responsesOutput } from "../../helpers/opencode";

const base = { model: "example-model", ...opencodeChatRequest };
const schema = { type: "object", properties: { city: { type: "string" } } };
const tool = {
  type: "function",
  function: {
    name: "weather",
    description: "Find weather",
    parameters: schema,
  },
};
function records(...events: unknown[]) {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}
function stream(body: string, includeUsage = false) {
  const response = new Response(body, {
    headers: {
      "content-type": "text/event-stream",
      "content-length": "123",
      etag: "old",
    },
  });
  return responsesStream(response, response.body!, base.model, includeUsage);
}
function chunks(value: string) {
  return value
    .split("\n\n")
    .filter((block) => block.startsWith("data:") && !block.includes("[DONE]"))
    .map((block) => JSON.parse(block.slice(5)));
}
const toolStart = {
  type: "response.output_item.added",
  output_index: 1,
  item: {
    type: "function_call",
    call_id: "call-1",
    name: "weather",
    arguments: "",
  },
};
const completed = {
  type: "response.completed",
  response: { status: "completed", usage: responsesOutput.usage },
};

describe("Chat to Responses requests", () => {
  it("preserves ordered instructions, text, images, tool history and refusals", () => {
    const data = prepareResponsesRequest({
      ...base,
      messages: [
        { role: "system", content: "system" },
        { role: "developer", content: [{ type: "text", text: "developer" }] },
        {
          role: "user",
          content: [
            { type: "text", text: "question" },
            {
              type: "image_url",
              image_url: {
                url: "https://example.test/image.png",
                detail: "low",
              },
            },
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,aGVsbG8=" },
            },
          ],
        },
        {
          role: "assistant",
          content: "checking",
          tool_calls: [
            {
              type: "function",
              id: "call-1",
              function: { name: "weather", arguments: '{"city":"Tokyo"}' },
            },
          ],
        },
        { role: "tool", tool_call_id: "call-1", content: "sunny" },
        { role: "assistant", content: null, refusal: "cannot answer" },
        { role: "assistant", refusal: null },
      ],
    });
    expect(data).toEqual({
      model: base.model,
      store: false,
      max_output_tokens: 32,
      input: [
        { role: "system", content: [{ type: "input_text", text: "system" }] },
        {
          role: "developer",
          content: [{ type: "input_text", text: "developer" }],
        },
        {
          role: "user",
          content: [
            { type: "input_text", text: "question" },
            {
              type: "input_image",
              image_url: "https://example.test/image.png",
              detail: "low",
            },
            {
              type: "input_image",
              image_url: "data:image/png;base64,aGVsbG8=",
            },
          ],
        },
        {
          role: "assistant",
          content: [{ type: "output_text", text: "checking" }],
        },
        {
          type: "function_call",
          call_id: "call-1",
          name: "weather",
          arguments: '{"city":"Tokyo"}',
        },
        { type: "function_call_output", call_id: "call-1", output: "sunny" },
        {
          role: "assistant",
          content: [{ type: "refusal", refusal: "cannot answer" }],
        },
      ],
    });
  });

  it("maps token limits, function tools, tool choice and text controls", () => {
    const converted = prepareResponsesRequest({
      ...base,
      max_completion_tokens: 64,
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.5,
      top_p: 0.8,
      n: 1,
      tools: [tool, { ...tool, function: { ...tool.function, strict: true } }],
      tool_choice: { type: "function", function: { name: "weather" } },
      parallel_tool_calls: false,
      response_format: {
        type: "json_schema",
        json_schema: { name: "result", schema, strict: false },
      },
      reasoning_effort: "high",
      verbosity: "low",
      store: true,
      metadata: { project: "example" },
      user: "example-user",
      service_tier: "auto",
      prompt_cache_key: "example-cache",
      prompt_cache_retention: "24h",
      safety_identifier: "example-safety",
    });
    expect(converted).toMatchObject({
      max_output_tokens: 64,
      stream: true,
      temperature: 0.5,
      top_p: 0.8,
      tools: [
        { type: "function", ...tool.function, strict: false },
        { type: "function", ...tool.function, strict: true },
      ],
      tool_choice: { type: "function", name: "weather" },
      parallel_tool_calls: false,
      text: {
        format: { type: "json_schema", name: "result", schema, strict: false },
        verbosity: "low",
      },
      reasoning: { effort: "high" },
      store: true,
      metadata: { project: "example" },
      user: "example-user",
      service_tier: "auto",
      prompt_cache_key: "example-cache",
      prompt_cache_retention: "24h",
      safety_identifier: "example-safety",
    });
    expect(converted).not.toHaveProperty("stream_options");
    expect(converted).not.toHaveProperty("n");
    expect(
      prepareResponsesRequest({ model: base.model, messages: [] }),
    ).not.toHaveProperty("max_output_tokens");
  });

  it.each(["text", "json_object"])(
    "maps %s output and string tool choice",
    (type) => {
      expect(
        prepareResponsesRequest({
          ...base,
          response_format: { type },
          tool_choice: "auto",
        }),
      ).toMatchObject({ text: { format: { type } }, tool_choice: "auto" });
    },
  );

  it.each([
    { unexpected: true },
    { n: 2 },
    { stop: ["end"] },
    { messages: {} },
    { messages: [null] },
    { messages: [{ role: "user", content: 123 }] },
    { messages: [{ role: "user", content: [{ type: "text", text: false }] }] },
    { messages: [{ role: "user", content: [{ type: "audio" }] }] },
    {
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: "file:///private" } },
          ],
        },
      ],
    },
    {
      messages: [
        {
          role: "assistant",
          content: [
            { type: "image_url", image_url: { url: "https://example.test" } },
          ],
        },
      ],
    },
    { messages: [{ role: "user", content: "hello", name: "name" }] },
    { messages: [{ role: "assistant", function_call: {} }] },
    { messages: [{ role: "other", content: "hello" }] },
    { messages: [{ role: "user", content: "hello", refusal: "no" }] },
    { messages: [{ role: "user", content: "hello", tool_calls: [] }] },
    { messages: [{ role: "assistant", tool_calls: [{ type: "custom" }] }] },
    { tools: [{ type: "web_search" }] },
    { tools: [{ type: "function", function: null }] },
    { tool_choice: { type: "custom" } },
    { response_format: { type: "unknown" } },
  ])("rejects unsupported or malformed conversion input %j", (changes) => {
    expect(() => prepareResponsesRequest({ ...base, ...changes })).toThrow(
      "Native inference conversion does not support",
    );
  });
});

describe("Responses JSON to Chat", () => {
  it("maps content, refusal, tools and usage without reserializing arguments", () => {
    const result = convertResponsesJson(
      {
        ...responsesOutput,
        output: [
          { type: "reasoning", summary: [] },
          ...responsesOutput.output,
          { type: "message", content: [{ type: "refusal", refusal: "no" }] },
          {
            type: "function_call",
            call_id: "call-1",
            name: "weather",
            arguments: '{ "city": "Tokyo" }',
          },
        ],
      },
      base.model,
    );
    expect(result).toMatchObject({
      id: "resp_example",
      created: 123,
      model: base.model,
      object: "chat.completion",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "hello back",
            refusal: "no",
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: { name: "weather", arguments: '{ "city": "Tokyo" }' },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: {
        prompt_tokens: 2,
        completion_tokens: 3,
        total_tokens: 5,
        prompt_tokens_details: { cached_tokens: 1 },
        completion_tokens_details: { reasoning_tokens: 1 },
      },
    });
    expect(
      convertResponsesJson({ status: "completed", output: [] }, base.model),
    ).toMatchObject({
      id: expect.stringMatching(/^chatcmpl_/),
      created: expect.any(Number),
      choices: [{ message: { content: null }, finish_reason: "stop" }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
    expect(responsesUsage({})).toEqual({
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    });
  });

  it.each([
    ["max_output_tokens", "length"],
    ["content_filter", "content_filter"],
  ])("maps incomplete reason %s", (reason, finish) => {
    expect(
      responsesFinishReason(
        { status: "incomplete", incomplete_details: { reason } },
        true,
      ),
    ).toBe(finish);
  });

  it.each([
    { status: "failed" },
    { status: "completed", error: { message: "failed" } },
    { status: "incomplete", incomplete_details: { reason: "unknown" } },
    { output: [{ type: "message", content: [{ type: "audio" }] }] },
    {
      output: [
        { type: "message", content: [{ type: "output_text", text: 123 }] },
      ],
    },
    { output: [{ type: "web_search_call" }] },
  ])("rejects invalid or failed JSON %j", (changes) => {
    expect(() =>
      convertResponsesJson({ ...responsesOutput, ...changes }, base.model),
    ).toThrow();
  });

  it("preserves HTTP errors and removes stale representation headers from successful conversions", async () => {
    const error = new Response("provider error", { status: 429 });
    expect(
      await responsesEndpoint.transformResponse(error, base.model, {}),
    ).toBe(error);
    const response = await responsesEndpoint.transformResponse(
      new Response(JSON.stringify(responsesOutput), {
        headers: { "content-length": "999", etag: "stale" },
      }),
      base.model,
      {},
    );
    expect(response.status).toBe(200);
    expect(response.headers.has("etag")).toBe(false);
    expect(response.headers.has("content-length")).toBe(false);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toMatchObject({
      choices: [{ message: { content: "hello back" } }],
    });
  });

  it("returns 502 for invalid, empty or oversized successful upstream bodies", async () => {
    for (const source of [
      new Response("{"),
      Response.json(null),
      new Response(null),
      new Response("x", {
        headers: { "content-length": String(5 * 1024 * 1024 + 1) },
      }),
    ]) {
      const response = await responsesEndpoint.transformResponse(
        source,
        base.model,
        {},
      );
      expect(response.status).toBe(502);
      expect(await response.text()).toContain(
        "invalid Responses inference response",
      );
    }
  });
});

describe("Responses SSE to Chat", () => {
  it("streams text, refusal, sparse tool indexes, finish reason and requested usage", async () => {
    const response = stream(
      ": ping\n\n" +
        records(
          { type: "response.created", response: { id: "resp_example" } },
          {
            type: "response.output_item.added",
            output_index: 0,
            item: { type: "reasoning" },
          },
          { type: "response.output_text.delta", delta: "hello " },
          { type: "response.output_text.delta", delta: "back" },
          { type: "response.refusal.delta", delta: "no" },
          toolStart,
          {
            type: "response.function_call_arguments.delta",
            output_index: 1,
            delta: '{"city":',
          },
          {
            type: "response.function_call_arguments.delta",
            output_index: 1,
            delta: '"Tokyo"}',
          },
          {
            ...toolStart,
            output_index: 123,
            item: { ...toolStart.item, call_id: "call-2", arguments: "{}" },
          },
          completed,
        ),
      true,
    );
    const body = await response.text();
    const output = chunks(body);
    expect(output[0].choices[0].delta).toEqual({
      role: "assistant",
      content: "",
    });
    expect(
      output
        .flatMap((chunk) => chunk.choices)
        .map((choice) => choice.delta.content)
        .filter(Boolean)
        .join(""),
    ).toBe("hello back");
    expect(output[3].choices[0].delta).toEqual({ refusal: "no" });
    expect(output[4].choices[0].delta.tool_calls[0]).toMatchObject({
      index: 0,
      id: "call-1",
      type: "function",
      function: { name: "weather", arguments: "" },
    });
    expect(output[7].choices[0].delta.tool_calls[0]).toMatchObject({
      index: 1,
      id: "call-2",
      function: { arguments: "{}" },
    });
    expect(output.at(-2).choices[0].finish_reason).toBe("tool_calls");
    expect(output.at(-1).usage).toMatchObject({
      prompt_tokens: 2,
      completion_tokens: 3,
      total_tokens: 5,
    });
    expect(new Set(output.map((chunk) => chunk.id)).size).toBe(1);
    expect(body.endsWith("data: [DONE]\n\n")).toBe(true);
    expect(response.headers.has("content-length")).toBe(false);
    expect(response.headers.has("etag")).toBe(false);
  });

  it("handles a final unterminated record, omits unrequested usage, and maps incomplete output", async () => {
    const response = stream(
      `data: ${JSON.stringify({ type: "response.incomplete", response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } } })}`,
    );
    const output = chunks(await response.text());
    expect(output.at(-1).choices[0].finish_reason).toBe("length");
    expect(output.every((chunk) => chunk.usage === undefined)).toBe(true);
  });

  it.each([
    "",
    ": ping",
    records({ type: "response.created" }),
    "data: {\n\n",
    records([]),
    records({ type: "error" }),
    records({ type: "response.failed" }),
    records({ type: "response.output_text.delta", delta: null }),
    records({ ...toolStart, output_index: -1 }),
    records({ ...toolStart, output_index: "1" }),
    records({ ...toolStart, output_index: 0.5 }),
    records(toolStart, toolStart),
    records({
      type: "response.function_call_arguments.delta",
      output_index: 1,
      delta: "{}",
    }),
    records({ type: "response.completed", response: { status: "failed" } }),
    records(
      ...Array.from({ length: 65 }, (_, output_index) => ({
        ...toolStart,
        output_index,
      })),
    ),
    "data: " + "x".repeat(MAX_SSE_RECORD_BYTES) + "\n\n",
  ])("fails malformed, truncated or oversized SSE %#", async (body) => {
    await expect(stream(body).text()).rejects.toThrow();
  });

  it("propagates downstream cancellation to the upstream stream", async () => {
    const cancel = vi.fn();
    const source = new ReadableStream<Uint8Array>({ cancel });
    const response = responsesStream(
      new Response(null),
      source,
      base.model,
      false,
    );
    await response.body!.cancel();
    await Promise.resolve();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([
    {},
    { stream_options: {} },
    { stream_options: { include_usage: false } },
    { stream_options: { include_usage: true } },
  ])("selects SSE conversion with usage option %j", async (request) => {
    const response = await responsesEndpoint.transformResponse(
      new Response(records(completed), {
        headers: { "content-type": "TEXT/EVENT-STREAM" },
      }),
      base.model,
      request,
    );
    const output = chunks(await response.text());
    expect(output.some((chunk) => chunk.usage)).toBe(
      "stream_options" in request &&
        request.stream_options?.include_usage === true,
    );
  });
});
