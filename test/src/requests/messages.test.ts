import { beforeEach, describe, expect, it, vi } from "vitest";
import { CloudflareAIGateway } from "~/src/ai_gateway";
import { handleChatCompletionsRequest } from "~/src/requests/chat_completions";
import { handleMessagesRequest } from "~/src/requests/messages";
import { Config } from "~/src/utils/config";

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
    );
    const chatRequest = vi.mocked(handleChatCompletionsRequest).mock.calls[0][0]
      .request;
    expect(chatRequest.headers.get("anthropic-version")).toBeNull();
    expect(chatRequest.headers.get("anthropic-beta")).toBeNull();
    expect(chatRequest.headers.get("x-client")).toBe("retained");
    expect(await chatRequest.json()).toEqual({
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
      model: "virtual/claude",
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: {
        input_tokens: 12,
        output_tokens: 4,
        cache_read_input_tokens: 3,
      },
      llm_proxy: { provider: "openai", model: "gpt-test" },
    });
    expect(converted.id).toMatch(/^msg_[a-f0-9]{32}$/);
    expect(converted.content).toEqual([
      { type: "text", text: "Hello" },
      { type: "text", text: "Cannot continue" },
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
        metadata: {},
        tools: [{ name: "minimal", input_schema: {} }],
        tool_choice: { type: "any" },
      }),
    } as never);
    let chatRequest = vi.mocked(handleChatCompletionsRequest).mock.calls[0][0]
      .request;
    expect(await chatRequest.json()).toMatchObject({
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
    expect((await filtered.json()).stop_reason).toBe("refusal");
    chatRequest = vi.mocked(handleChatCompletionsRequest).mock.calls[1][0]
      .request;
    expect(await chatRequest.json()).toMatchObject({
      tool_choice: "none",
      parallel_tool_calls: true,
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
    expect(events.map((event) => event.type)).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_delta",
      "content_block_start",
      "content_block_delta",
      "content_block_delta",
      "content_block_start",
      "content_block_start",
      "content_block_stop",
      "content_block_stop",
      "content_block_stop",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);
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
      delta: { stop_reason: "tool_use", stop_sequence: null },
      usage: { input_tokens: 3, output_tokens: 2 },
      llm_proxy: { provider: "anthropic" },
    });
    const chatRequest = vi.mocked(handleChatCompletionsRequest).mock.calls[0][0]
      .request;
    expect(await chatRequest.json()).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    });
  });

  it("finishes unterminated streams and reports malformed chunks", async () => {
    vi.mocked(handleChatCompletionsRequest).mockResolvedValue(
      new Response("data: not-json", {
        headers: { "content-type": "text/event-stream" },
      }),
    );
    const response = await handleMessagesRequest({
      request: request({ model: "openai/model", max_tokens: 1, messages: [] }),
    } as never);
    const body = await response.text();
    expect(body).toContain("event: error");
    expect(body).toContain("event: message_start");
    expect(body).toContain("event: message_stop");
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

  it.each([
    ["invalid JSON", "{"],
    ["missing fields", { model: undefined }],
    ["unknown field", { unknown: true }],
    ["invalid message", { messages: [{ role: "system", content: "x" }] }],
    ["invalid content", { messages: [{ role: "user", content: 1 }] }],
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
  ])("rejects %s", async (_name, partial) => {
    const body =
      typeof partial === "string"
        ? partial
        : { model: "openai/model", max_tokens: 10, messages: [], ...partial };
    const response = await handleMessagesRequest({
      request: request(body),
    } as never);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      type: "error",
      error: { type: "invalid_request_error" },
    });
    expect(handleChatCompletionsRequest).not.toHaveBeenCalled();
  });
});
