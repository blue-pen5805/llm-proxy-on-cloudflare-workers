import { beforeEach, describe, expect, it, vi } from "vitest";
import { CloudflareAIGateway } from "~/src/ai_gateway";
import { handleChatCompletionsRequest } from "~/src/requests/chat_completions";
import { handleMessagesRequest } from "~/src/requests/messages";
import {
  convertMessagesRequest,
  SUPPORTED_REQUEST_FIELDS,
} from "~/src/requests/messages/request";
import {
  MAX_SSE_RECORD_BYTES,
  MAX_STREAM_TEXT_BYTES,
  MAX_STREAM_TOOL_ARGUMENT_BYTES,
} from "~/src/requests/stream_limits";
import { Config } from "~/src/utils/config";
import { PayloadTooLargeError } from "~/src/utils/error";

vi.mock("~/src/requests/chat_completions", () => ({
  handleChatCompletionsRequest: vi.fn(),
}));

describe("handleMessagesRequest", () => {
  const request = (body: unknown, headers: HeadersInit = {}) =>
    new Request("https://proxy.example/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "example-beta",
        "x-client": "retained",
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("declares the top-level fields converted to Chat Completions", () => {
    expect([...SUPPORTED_REQUEST_FIELDS]).toEqual([
      "max_tokens",
      "messages",
      "metadata",
      "model",
      "output_config",
      "stop_sequences",
      "stream",
      "system",
      "temperature",
      "tool_choice",
      "tools",
      "top_p",
    ]);
    expect(
      convertMessagesRequest({
        model: "openai/model",
        max_tokens: 10,
        messages: [],
        future_option: true,
      }).request,
    ).toEqual({
      model: "openai/model",
      max_tokens: 10,
      messages: [],
    });
  });

  it("converts a Messages request to Chat Completions and JSON output back", async () => {
    vi.spyOn(Config, "chatResponseMetadataEnabled").mockReturnValue(true);
    vi.mocked(handleChatCompletionsRequest).mockResolvedValue(
      Response.json(
        {
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                content: "Hello",
                refusal: "Cannot continue",
                tool_calls: [
                  {
                    id: "toolu_weather",
                    function: {
                      name: "weather",
                      arguments: '{"city":"Tokyo"}',
                    },
                  },
                  { function: { arguments: "not-json" } },
                  { id: "toolu_empty", function: { arguments: 1 } },
                  null,
                ],
              },
            },
          ],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 4,
            prompt_tokens_details: { cached_tokens: 3 },
          },
          llm_proxy: { provider: "openai", model: "gpt-test" },
        },
        {
          headers: {
            "content-length": "100",
            etag: "stale",
            "x-upstream": "retained",
          },
        },
      ),
    );
    const gateway = new CloudflareAIGateway("account", "gateway", "token");

    const response = await handleMessagesRequest(
      {
        request: request({
          model: "virtual/claude",
          max_tokens: 256,
          system: [{ type: "text", text: "Be concise" }],
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "Before" },
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: "image/png",
                    data: "aGVsbG8=",
                  },
                },
                {
                  type: "tool_result",
                  tool_use_id: "toolu_previous",
                  content: [{ type: "text", text: "sunny" }],
                },
                {
                  type: "image",
                  source: { type: "url", url: "https://images.example/a.png" },
                },
              ],
            },
            {
              role: "assistant",
              content: [
                {
                  type: "tool_use",
                  id: "toolu_next",
                  name: "weather",
                  input: { city: "Tokyo" },
                },
              ],
            },
          ],
          metadata: { user_id: "user-1" },
          stop_sequences: ["END"],
          temperature: 0.2,
          top_p: 0.8,
          tools: [
            {
              name: "weather",
              description: "Get weather",
              input_schema: { type: "object" },
            },
          ],
          tool_choice: {
            type: "tool",
            name: "weather",
            disable_parallel_tool_use: true,
          },
        }),
      } as never,
      gateway,
    );

    expect(handleChatCompletionsRequest).toHaveBeenCalledWith(
      expect.objectContaining({ request: expect.any(Request) }),
      gateway,
      expect.objectContaining({
        endpoint: "messages",
        responseMetadataEnabled: true,
      }),
    );
    const preparedRequest = vi.mocked(handleChatCompletionsRequest).mock
      .calls[0][2]!;
    const chatHeaders = new Headers(preparedRequest.headers);
    expect(chatHeaders.get("anthropic-version")).toBeNull();
    expect(chatHeaders.get("anthropic-beta")).toBeNull();
    expect(chatHeaders.get("x-client")).toBe("retained");
    expect(preparedRequest.body).toEqual({
      model: "virtual/claude",
      messages: [
        { role: "system", content: [{ type: "text", text: "Be concise" }] },
        {
          role: "user",
          content: [
            { type: "text", text: "Before" },
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,aGVsbG8=" },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "toolu_previous",
          content: [{ type: "text", text: "sunny" }],
        },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: "https://images.example/a.png" },
            },
          ],
        },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "toolu_next",
              type: "function",
              function: {
                name: "weather",
                arguments: '{"city":"Tokyo"}',
              },
            },
          ],
        },
      ],
      max_completion_tokens: 256,
      stop: ["END"],
      temperature: 0.2,
      top_p: 0.8,
      user: "user-1",
      tools: [
        {
          type: "function",
          function: {
            name: "weather",
            description: "Get weather",
            parameters: { type: "object" },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "weather" } },
      parallel_tool_calls: false,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBeNull();
    expect(response.headers.get("etag")).toBeNull();
    expect(response.headers.get("x-upstream")).toBe("retained");
    const converted = (await response.json()) as Record<string, any>;
    expect(converted).toMatchObject({
      type: "message",
      role: "assistant",
      container: null,
      model: "virtual/claude",
      stop_details: null,
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: {
        cache_creation: null,
        cache_creation_input_tokens: null,
        input_tokens: 12,
        output_tokens: 4,
        cache_read_input_tokens: 3,
        inference_geo: null,
        output_tokens_details: null,
        server_tool_use: null,
        service_tier: null,
      },
      llm_proxy: { provider: "openai", model: "gpt-test" },
    });
    expect(converted.id).toMatch(/^msg_[a-f0-9]{32}$/);
    expect(converted.content).toEqual([
      { type: "text", text: "Hello", citations: null },
      { type: "text", text: "Cannot continue", citations: null },
      {
        type: "tool_use",
        id: "toolu_weather",
        name: "weather",
        input: { city: "Tokyo" },
      },
      {
        type: "tool_use",
        id: expect.stringMatching(/^toolu_/),
        name: "",
        input: {},
      },
      {
        type: "tool_use",
        id: "toolu_empty",
        name: "",
        input: {},
      },
    ]);
  });

  it("converts simple messages, tool results, choices, and safe response defaults", async () => {
    vi.mocked(handleChatCompletionsRequest).mockResolvedValue(
      Response.json({ choices: [null, { finish_reason: "length" }] }),
    );
    await handleMessagesRequest({
      request: request({
        model: "openai/model",
        max_tokens: 10,
        system: "System",
        messages: [
          { role: "user", content: "Hello" },
          {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: "toolu_1", content: "ok" },
            ],
          },
          { role: "assistant", content: [] },
        ],
        stream: false,
        metadata: { user_id: null },
        output_config: { format: null },
        tools: [{ name: "minimal", input_schema: {} }],
        tool_choice: { type: "any" },
      }),
    } as never);
    let preparedRequest = vi.mocked(handleChatCompletionsRequest).mock
      .calls[0][2]!;
    expect(preparedRequest.body).toMatchObject({
      stream: false,
      messages: [
        { role: "system", content: "System" },
        { role: "user", content: "Hello" },
        { role: "tool", tool_call_id: "toolu_1", content: "ok" },
        { role: "assistant", content: [] },
      ],
      tools: [
        { type: "function", function: { name: "minimal", parameters: {} } },
      ],
      tool_choice: "required",
    });

    vi.mocked(handleChatCompletionsRequest).mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ finish_reason: "content_filter", message: {} }],
        }),
      ),
    );
    const filtered = await handleMessagesRequest({
      request: request({
        model: "openai/model",
        max_tokens: 10,
        messages: [],
        tool_choice: { type: "none", disable_parallel_tool_use: false },
      }),
    } as never);
    expect(
      ((await filtered.json()) as { stop_reason: string }).stop_reason,
    ).toBe("refusal");
    preparedRequest = vi.mocked(handleChatCompletionsRequest).mock.calls[1][2]!;
    expect(preparedRequest.body).toMatchObject({
      tool_choice: "none",
      parallel_tool_calls: true,
    });
  });

  it("drops known unsupported parameters and converts compatible nested options", async () => {
    vi.mocked(handleChatCompletionsRequest).mockResolvedValue(
      Response.json({ choices: [{ message: { content: "ok" } }] }),
    );

    const response = await handleMessagesRequest({
      request: request({
        model: "openai/model",
        max_tokens: 10,
        messages: [
          {
            role: "system",
            content: [
              { type: "text", text: "Direct system" },
              {
                type: "mid_conv_system",
                content: [
                  {
                    type: "text",
                    text: "Updated system",
                    cache_control: { type: "ephemeral" },
                  },
                ],
                cache_control: { type: "ephemeral" },
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Hello",
                cache_control: { type: "ephemeral" },
              },
              {
                type: "image",
                source: { type: "url", url: "https://images.example/a.png" },
                cache_control: { type: "ephemeral" },
              },
              {
                type: "mid_conv_system",
                content: [{ type: "text", text: "User-turn system" }],
              },
              { type: "document", source: { type: "url" } },
            ],
          },
          {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_1",
                name: "lookup",
                input: {},
                cache_control: { type: "ephemeral" },
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_1",
                content: [
                  {
                    type: "text",
                    text: "done",
                    cache_control: { type: "ephemeral" },
                  },
                ],
                cache_control: { type: "ephemeral" },
              },
              {
                type: "tool_result",
                tool_use_id: "toolu_2",
                is_error: true,
              },
            ],
          },
        ],
        system: [
          {
            type: "text",
            text: "System",
            cache_control: { type: "ephemeral" },
          },
          { type: "thinking", thinking: "ignored" },
        ],
        tools: [
          {
            name: "search",
            type: "web_search_20250305",
            input_schema: { type: "object" },
          },
          {
            name: "lookup",
            type: "custom",
            input_schema: { type: "object" },
            strict: true,
            cache_control: { type: "ephemeral" },
          },
        ],
        output_config: {
          effort: "high",
          format: {
            type: "json_schema",
            schema: { type: "object" },
          },
          future_option: true,
        },
        cache_control: { type: "ephemeral" },
        container: "container_1",
        context_management: { edits: [] },
        inference_geo: "us",
        mcp_servers: [{ type: "url", name: "tools" }],
        service_tier: "auto",
        thinking: { type: "adaptive" },
        top_k: 20,
        user_profile_id: "profile_1",
        future_option: true,
      }),
    } as never);

    expect(response.status).toBe(200);
    const preparedRequest = vi.mocked(handleChatCompletionsRequest).mock
      .calls[0][2]!;
    expect(preparedRequest.body).toEqual({
      model: "openai/model",
      messages: [
        {
          role: "system",
          content: [{ type: "text", text: "System" }],
        },
        {
          role: "system",
          content: [
            { type: "text", text: "Direct system" },
            { type: "text", text: "Updated system" },
          ],
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Hello" },
            {
              type: "image_url",
              image_url: { url: "https://images.example/a.png" },
            },
          ],
        },
        {
          role: "system",
          content: [{ type: "text", text: "User-turn system" }],
        },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "toolu_1",
              type: "function",
              function: { name: "lookup", arguments: "{}" },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "toolu_1",
          content: [{ type: "text", text: "done" }],
        },
        { role: "tool", tool_call_id: "toolu_2", content: "" },
      ],
      max_completion_tokens: 10,
      reasoning_effort: "high",
      response_format: {
        type: "json_schema",
        json_schema: { name: "response", schema: { type: "object" } },
      },
      tools: [
        {
          type: "function",
          function: {
            name: "lookup",
            parameters: { type: "object" },
            strict: true,
          },
        },
      ],
    });
  });

  it("converts Chat text and function streaming chunks to Messages events", async () => {
    vi.spyOn(Config, "chatResponseMetadataEnabled").mockReturnValue(true);
    const sse = [
      'data: {"choices":[{"delta":{"content":"Hel"},"finish_reason":null}]}',
      "",
      'data: {"choices":[{"delta":{"content":"lo","tool_calls":[{"index":0,"id":"toolu_1","function":{"name":"lookup","arguments":"{\\"q\\":"}}]},"finish_reason":null}]}',
      "",
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"lookup","arguments":"\\"x\\"}"}},{"index":1,"function":{}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}',
      "",
      'data: {"choices":[],"llm_proxy":{"provider":"anthropic"}}',
      "",
      "event: ping",
      "",
      "data: null",
      "",
      'data: {"other":true}',
      "",
      'data: {"choices":[null,{"delta":null},{"delta":{"tool_calls":[null,{"index":"bad"},{"index":2,"function":null}]}}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\r\n");
    vi.mocked(handleChatCompletionsRequest).mockResolvedValue(
      new Response(`${sse}\r\n`, {
        headers: {
          "content-type": "text/event-stream",
          "content-encoding": "gzip",
          digest: "stale",
        },
      }),
    );

    const response = await handleMessagesRequest({
      request: request({
        model: "anthropic/model",
        max_tokens: 20,
        messages: [{ role: "user", content: "Hello" }],
        stream: true,
      }),
    } as never);

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("digest")).toBeNull();
    const events = (await response.text())
      .split("\n\n")
      .filter(Boolean)
      .map((block) =>
        JSON.parse(
          block
            .split("\n")
            .find((line) => line.startsWith("data: "))!
            .slice(6),
        ),
      );
    // Blocks never interleave: the text block is closed before the first
    // tool_use block opens, and each tool_use block is emitted in full.
    expect(events.map((event) => event.type)).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_delta",
      "content_block_stop",
      "content_block_start",
      "content_block_delta",
      "content_block_stop",
      "content_block_start",
      "content_block_stop",
      "content_block_start",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);
    expect(
      events
        .filter((event) => event.type === "content_block_start")
        .map((event) => event.index),
    ).toEqual([0, 1, 2, 3]);
    expect(
      events
        .filter((event) => event.delta?.type === "text_delta")
        .map((event) => event.delta.text)
        .join(""),
    ).toBe("Hello");
    expect(
      events
        .filter((event) => event.delta?.type === "input_json_delta")
        .map((event) => event.delta.partial_json)
        .join(""),
    ).toBe('{"q":"x"}');
    expect(events.at(-2)).toMatchObject({
      delta: {
        container: null,
        stop_details: null,
        stop_reason: "tool_use",
        stop_sequence: null,
      },
      usage: {
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        input_tokens: 3,
        output_tokens: 2,
        output_tokens_details: null,
        server_tool_use: null,
      },
      llm_proxy: { provider: "anthropic" },
    });
    expect(events[0].message).toMatchObject({
      container: null,
      stop_details: null,
      usage: {
        cache_creation: null,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        inference_geo: null,
        output_tokens_details: null,
        server_tool_use: null,
        service_tier: null,
      },
    });
    expect(events[1].content_block).toEqual({
      type: "text",
      text: "",
      citations: null,
    });
    const preparedRequest = vi.mocked(handleChatCompletionsRequest).mock
      .calls[0][2]!;
    expect(preparedRequest.body).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    });
  });

  it("terminates malformed streams without emitting a successful stop", async () => {
    const cancel = vi.fn();
    let sent = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) return;
        sent = true;
        controller.enqueue(new TextEncoder().encode("data: not-json\n\n"));
      },
      cancel,
    });
    vi.mocked(handleChatCompletionsRequest).mockResolvedValue(
      new Response(stream, {
        headers: { "content-type": "text/event-stream" },
      }),
    );
    const response = await handleMessagesRequest({
      request: request({ model: "openai/model", max_tokens: 1, messages: [] }),
    } as never);
    const body = await response.text();
    expect(body).toContain("event: error");
    expect(body).toContain("event: message_start");
    expect(body).not.toContain("event: message_stop");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("terminates a stream when cumulative tool arguments exceed their byte budget", async () => {
    const delta = "x".repeat(900 * 1024);
    const sse = Array.from(
      { length: Math.ceil(MAX_STREAM_TOOL_ARGUMENT_BYTES / delta.length) + 1 },
      (_, index) =>
        `data: ${JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    ...(index === 0
                      ? { id: "toolu_1", function: { name: "lookup" } }
                      : {}),
                    function: {
                      ...(index === 0 ? { name: "lookup" } : {}),
                      arguments: delta,
                    },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        })}\n\n`,
    ).join("");
    vi.mocked(handleChatCompletionsRequest).mockResolvedValue(
      new Response(sse, {
        headers: { "content-type": "text/event-stream" },
      }),
    );

    const response = await handleMessagesRequest({
      request: request({
        model: "openai/model",
        max_tokens: 1,
        messages: [],
        stream: true,
      }),
    } as never);
    const body = await response.text();

    expect(body).toContain("Streaming tool arguments exceed the proxy limit.");
    expect(body).not.toContain("event: message_stop");
  });

  it("enforces the independent text, tool-count, and output-item budgets", async () => {
    const textDelta = "x".repeat(900 * 1024);
    const toolCalls = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        index,
        id: `call_${index}`,
        function: { name: "lookup", arguments: "" },
      }));
    const cases = [
      {
        expected: "Streaming text exceeds the proxy limit.",
        sse: Array.from(
          { length: Math.ceil(MAX_STREAM_TEXT_BYTES / textDelta.length) + 1 },
          () =>
            `data: ${JSON.stringify({
              choices: [{ delta: { content: textDelta }, finish_reason: null }],
            })}\n\n`,
        ).join(""),
      },
      {
        expected: "Streaming tool call count exceeds the proxy limit.",
        sse: `data: ${JSON.stringify({
          choices: [
            { delta: { tool_calls: toolCalls(65) }, finish_reason: null },
          ],
        })}\n\n`,
      },
      {
        expected: "Streaming output item count exceeds the proxy limit.",
        sse:
          `data: ${JSON.stringify({
            choices: [
              { delta: { tool_calls: toolCalls(64) }, finish_reason: null },
            ],
          })}\n\n` +
          `data: ${JSON.stringify({
            choices: [
              { delta: { content: "one item too many" }, finish_reason: null },
            ],
          })}\n\n`,
      },
    ];

    for (const testCase of cases) {
      vi.mocked(handleChatCompletionsRequest).mockResolvedValue(
        new Response(testCase.sse, {
          headers: { "content-type": "text/event-stream" },
        }),
      );
      const response = await handleMessagesRequest({
        request: request({
          model: "openai/model",
          max_tokens: 1,
          messages: [],
          stream: true,
        }),
      } as never);
      const body = await response.text();
      expect(body).toContain(testCase.expected);
      expect(body).not.toContain("event: message_stop");
    }
  });

  // The shared SSE record reader enforces the record size and encoding limits
  // themselves; this only asserts that its failures reach the client as a
  // terminal Messages error instead of a truncated success.
  it("reports a shared SSE reader failure as a terminal error", async () => {
    vi.mocked(handleChatCompletionsRequest).mockResolvedValue(
      new Response(`data: ${"x".repeat(MAX_SSE_RECORD_BYTES + 1)}\n\n`, {
        headers: { "content-type": "text/event-stream" },
      }),
    );

    const response = await handleMessagesRequest({
      request: request({
        model: "openai/model",
        max_tokens: 1,
        messages: [],
        stream: true,
      }),
    } as never);

    const body = await response.text();
    expect(body).toContain("Upstream SSE record exceeds the proxy limit.");
    expect(body).not.toContain("event: message_stop");
  });

  const streamResponse = async (upstream: string) => {
    vi.mocked(handleChatCompletionsRequest).mockResolvedValue(
      new Response(upstream, {
        headers: { "content-type": "text/event-stream" },
      }),
    );
    const response = await handleMessagesRequest({
      request: request({
        model: "openai/model",
        max_tokens: 1,
        messages: [],
        stream: true,
      }),
    } as never);
    return await response.text();
  };

  it("processes a final valid SSE record without a blank-line delimiter", async () => {
    const body = await streamResponse(
      `data: ${JSON.stringify({
        choices: [{ delta: { content: "tail" }, finish_reason: "stop" }],
      })}\n\ndata: [DONE]`,
    );

    expect(body).toContain('"text":"tail"');
    expect(body).toContain("event: message_stop");
  });

  it("completes a terminated empty stream without content blocks", async () => {
    const body = await streamResponse("data: [DONE]\n\n");

    expect(body).toContain("event: message_stop");
    expect(body).not.toContain("event: content_block_stop");
  });

  it("ignores non-data records, including a final unterminated record", async () => {
    const terminated = await streamResponse("event: ping\n\ndata: [DONE]\n\n");
    expect(terminated).toContain("event: message_stop");

    const truncated = await streamResponse("event: ping");
    expect(truncated).toContain(
      "Upstream stream ended without a terminal event.",
    );
  });

  it("fails a stream that ends before its terminal event", async () => {
    const body = await streamResponse(
      `data: ${JSON.stringify({
        choices: [{ delta: { content: "par" } }],
      })}\n\n`,
    );

    expect(body).toContain("event: error");
    expect(body).toContain("Upstream stream ended without a terminal event.");
    expect(body).not.toContain("event: message_stop");
    expect(body).not.toContain("event: message_delta");
  });

  it("fails an upstream stream that carries no event at all", async () => {
    const body = await streamResponse("");

    expect(body).toContain("event: message_start");
    expect(body).toContain("event: error");
    expect(body).not.toContain("event: message_stop");
  });

  it("applies a tool name that only arrives in a later delta", async () => {
    const body = await streamResponse(
      [
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"toolu_x","function":{"arguments":"{}"}}]}}]}',
        "",
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"lookup"}}]}}]}',
        "",
        "data: [DONE]",
        "",
      ].join("\n"),
    );

    expect(body).toContain('"name":"lookup"');
    expect(body).toContain("event: message_stop");
  });

  it("preserves payload-too-large errors from bounded request parsing", async () => {
    const oversized = new Request("https://proxy.example/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(10 * 1024 * 1024 + 1),
      },
      body: "{}",
    });

    await expect(
      handleMessagesRequest({ request: oversized } as never),
    ).rejects.toBeInstanceOf(PayloadTooLargeError);
    expect(handleChatCompletionsRequest).not.toHaveBeenCalled();
  });

  it("passes upstream errors through and rejects invalid upstream success responses", async () => {
    vi.mocked(handleChatCompletionsRequest).mockResolvedValue(
      Response.json({ error: "rate limited" }, { status: 429 }),
    );
    const upstreamError = await handleMessagesRequest({
      request: request({ model: "openai/model", max_tokens: 1, messages: [] }),
    } as never);
    expect(upstreamError.status).toBe(429);
    expect(await upstreamError.json()).toEqual({ error: "rate limited" });

    vi.mocked(handleChatCompletionsRequest).mockResolvedValue(
      new Response("invalid json"),
    );
    const malformed = await handleMessagesRequest({
      request: request({ model: "openai/model", max_tokens: 1, messages: [] }),
    } as never);
    expect(malformed.status).toBe(502);

    vi.mocked(handleChatCompletionsRequest).mockResolvedValue(
      Response.json({ object: "not-chat" }),
    );
    const wrongShape = await handleMessagesRequest({
      request: request({ model: "openai/model", max_tokens: 1, messages: [] }),
    } as never);
    expect(wrongShape.status).toBe(502);

    const noContentType = Response.json({ choices: [{ message: {} }] });
    noContentType.headers.delete("content-type");
    vi.mocked(handleChatCompletionsRequest).mockResolvedValue(noContentType);
    expect(
      (
        await handleMessagesRequest({
          request: request({
            model: "openai/model",
            max_tokens: 1,
            messages: [],
          }),
        } as never)
      ).status,
    ).toBe(200);

    vi.mocked(handleChatCompletionsRequest).mockResolvedValue(
      new Response(null, { headers: { "content-type": "text/event-stream" } }),
    );
    expect(
      (
        await handleMessagesRequest({
          request: request({
            model: "openai/model",
            max_tokens: 1,
            messages: [],
          }),
        } as never)
      ).status,
    ).toBe(502);
  });

  const ignoredCompatibilityCases = new Set([
    "unknown field",
    "invalid message role",
    "invalid nested mid-conversation system block",
    "unsupported system block",
    "unknown content",
    "unknown image source",
    "invalid tool result block",
    "invalid system block",
    "invalid tools",
    "non-object tool choice",
    "invalid tool choice",
    "invalid metadata",
    "invalid output format",
    "invalid custom tool type",
  ]);

  it.each([
    ["invalid JSON", "{"],
    ["missing fields", { model: undefined }],
    ["invalid message", { messages: [null] }],
    ["unknown field", { unknown: true }],
    ["invalid content", { messages: [{ role: "user", content: 1 }] }],
    ["invalid message role", { messages: [{ role: "tool", content: "x" }] }],
    [
      "invalid system block",
      { messages: [{ role: "system", content: [null] }] },
    ],
    [
      "invalid mid-conversation system content",
      {
        messages: [
          {
            role: "system",
            content: [{ type: "mid_conv_system", content: "x" }],
          },
        ],
      },
    ],
    [
      "invalid nested mid-conversation system block",
      {
        messages: [
          {
            role: "system",
            content: [{ type: "mid_conv_system", content: [null] }],
          },
        ],
      },
    ],
    [
      "unsupported system block",
      {
        messages: [
          { role: "system", content: [{ type: "image", source: {} }] },
        ],
      },
    ],
    [
      "invalid content block",
      { messages: [{ role: "user", content: [null] }] },
    ],
    [
      "unknown content",
      { messages: [{ role: "user", content: [{ type: "document" }] }] },
    ],
    [
      "invalid image source",
      {
        messages: [
          { role: "user", content: [{ type: "image", source: null }] },
        ],
      },
    ],
    [
      "unknown image source",
      {
        messages: [
          {
            role: "user",
            content: [{ type: "image", source: { type: "file" } }],
          },
        ],
      },
    ],
    [
      "invalid tool result content",
      {
        messages: [
          {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "x", content: 1 }],
          },
        ],
      },
    ],
    [
      "invalid tool result block",
      {
        messages: [
          {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: "x", content: [null] },
            ],
          },
        ],
      },
    ],
    [
      "tool result on assistant",
      {
        messages: [
          {
            role: "assistant",
            content: [{ type: "tool_result", tool_use_id: "x", content: "x" }],
          },
        ],
      },
    ],
    [
      "tool use on user",
      {
        messages: [
          {
            role: "user",
            content: [{ type: "tool_use", id: "x", name: "x", input: {} }],
          },
        ],
      },
    ],
    ["invalid system", { system: 1 }],
    ["invalid system block", { system: [null] }],
    ["invalid tools", { tools: [{}] }],
    ["non-array tools", { tools: {} }],
    ["non-object tool choice", { tool_choice: "auto" }],
    ["invalid tool choice", { tool_choice: { type: "tool" } }],
    [
      "invalid parallel tool choice",
      { tool_choice: { type: "auto", disable_parallel_tool_use: "yes" } },
    ],
    ["invalid metadata", { metadata: { other: true } }],
    ["non-object metadata", { metadata: "user" }],
    ["invalid metadata user", { metadata: { user_id: 1 } }],
    ["invalid stops", { stop_sequences: "END" }],
    ["invalid output config", { output_config: "high" }],
    ["invalid output format", { output_config: { format: { type: "text" } } }],
    [
      "invalid custom tool type",
      { tools: [{ name: "tool", input_schema: {}, type: "server" }] },
    ],
  ])("handles %s", async (name, partial) => {
    const ignored = ignoredCompatibilityCases.has(name);
    if (ignored) {
      vi.mocked(handleChatCompletionsRequest).mockResolvedValue(
        Response.json({ choices: [{ message: { content: "ok" } }] }),
      );
    }
    const body =
      typeof partial === "string"
        ? partial
        : { model: "openai/model", max_tokens: 10, messages: [], ...partial };
    const response = await handleMessagesRequest({
      request: request(body),
    } as never);
    if (ignored) {
      expect(response.status).toBe(200);
      expect(handleChatCompletionsRequest).toHaveBeenCalledOnce();
    } else {
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        type: "error",
        error: { type: "invalid_request_error" },
      });
      expect(handleChatCompletionsRequest).not.toHaveBeenCalled();
    }
  });
});
