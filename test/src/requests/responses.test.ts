import { beforeEach, describe, expect, it, vi } from "vitest";
import { CloudflareAIGateway } from "~/src/ai_gateway";
import { handleChatCompletionsRequest } from "~/src/requests/chat_completions";
import { handleResponsesRequest } from "~/src/requests/responses";
import { Config } from "~/src/utils/config";

vi.mock("~/src/requests/chat_completions", () => ({
  handleChatCompletionsRequest: vi.fn(),
}));

describe("handleResponsesRequest", () => {
  const request = (body: unknown) =>
    new Request("https://proxy.example/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "999",
        "x-client": "retained",
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("converts a Responses request to Chat Completions and converts JSON output back", async () => {
    vi.spyOn(Config, "chatResponseMetadataEnabled").mockReturnValue(true);
    vi.mocked(handleChatCompletionsRequest).mockResolvedValue(
      Response.json(
        {
          id: "chatcmpl-upstream",
          object: "chat.completion",
          created: 123,
          model: "provider-model",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "Hello from chat",
                refusal: "brief refusal",
                tool_calls: [
                  {
                    id: "call_weather",
                    type: "function",
                    function: {
                      name: "weather",
                      arguments: '{"city":"Tokyo"}',
                    },
                  },
                ],
              },
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
            prompt_tokens_details: { cached_tokens: 2 },
            completion_tokens_details: { reasoning_tokens: 1 },
          },
          llm_proxy: {
            request_id: "request-json",
            provider: "openai",
            model: "gpt-5.4",
            requested_model: "virtual/fast",
            credential_profile: "default",
            credential_index: 1,
            via_ai_gateway: false,
          },
        },
        {
          headers: {
            "content-length": "999",
            etag: "stale",
            "x-upstream": "retained",
          },
        },
      ),
    );
    const gateway = new CloudflareAIGateway("account", "gateway", "token");
    const originalRequest = request({
      model: "virtual/fast",
      instructions: "Be concise",
      input: "Hello",
      tools: [
        {
          type: "function",
          name: "weather",
          description: "Get weather",
          parameters: { type: "object" },
          strict: true,
        },
      ],
      tool_choice: { type: "function", name: "weather" },
      text: {
        format: {
          type: "json_schema",
          name: "answer",
          description: "Answer schema",
          schema: { type: "object" },
          strict: true,
        },
      },
      reasoning: { effort: "medium" },
      max_output_tokens: 200,
      frequency_penalty: 0.1,
      logprobs: true,
      metadata: { tenant: "example" },
      parallel_tool_calls: false,
      presence_penalty: 0.2,
      seed: 7,
      service_tier: "default",
      store: false,
      temperature: 0.4,
      top_logprobs: 2,
      top_p: 0.9,
      truncation: "disabled",
      user: "user-1",
    });

    const response = await handleResponsesRequest(
      { request: originalRequest } as never,
      gateway,
    );

    expect(handleChatCompletionsRequest).toHaveBeenCalledWith(
      expect.objectContaining({ request: expect.any(Request) }),
      gateway,
      expect.objectContaining({ responseMetadataEnabled: true }),
    );
    const preparedRequest = vi.mocked(handleChatCompletionsRequest).mock
      .calls[0][2]!;
    const chatHeaders = new Headers(preparedRequest.headers);
    expect(chatHeaders.get("content-length")).toBeNull();
    expect(chatHeaders.get("x-client")).toBe("retained");
    expect(preparedRequest.body).toEqual({
      model: "virtual/fast",
      messages: [
        { role: "system", content: "Be concise" },
        { role: "user", content: "Hello" },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "weather",
            description: "Get weather",
            parameters: { type: "object" },
            strict: true,
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "weather" } },
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "answer",
          description: "Answer schema",
          schema: { type: "object" },
          strict: true,
        },
      },
      reasoning_effort: "medium",
      max_completion_tokens: 200,
      frequency_penalty: 0.1,
      logprobs: true,
      metadata: { tenant: "example" },
      parallel_tool_calls: false,
      presence_penalty: 0.2,
      seed: 7,
      service_tier: "default",
      store: false,
      temperature: 0.4,
      top_logprobs: 2,
      top_p: 0.9,
      user: "user-1",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBeNull();
    expect(response.headers.get("etag")).toBeNull();
    expect(response.headers.get("x-upstream")).toBe("retained");
    const converted = (await response.json()) as Record<string, any>;
    expect(converted).toMatchObject({
      object: "response",
      created_at: 123,
      status: "completed",
      instructions: "Be concise",
      max_output_tokens: 200,
      model: "virtual/fast",
      parallel_tool_calls: false,
      reasoning: { effort: "medium", summary: null },
      service_tier: "default",
      store: false,
      temperature: 0.4,
      tool_choice: { type: "function", name: "weather" },
      top_p: 0.9,
      truncation: "disabled",
      user: "user-1",
      metadata: { tenant: "example" },
      usage: {
        input_tokens: 10,
        input_tokens_details: { cached_tokens: 2 },
        output_tokens: 5,
        output_tokens_details: { reasoning_tokens: 1 },
        total_tokens: 15,
      },
      llm_proxy: {
        request_id: "request-json",
        provider: "openai",
        model: "gpt-5.4",
        requested_model: "virtual/fast",
        credential_profile: "default",
        credential_index: 1,
        via_ai_gateway: false,
      },
    });
    expect(converted.id).toMatch(/^resp_[a-f0-9]{32}$/);
    expect(converted.output).toEqual([
      {
        id: expect.stringMatching(/^msg_[a-f0-9]{32}$/),
        type: "message",
        status: "completed",
        role: "assistant",
        content: [
          { type: "output_text", text: "Hello from chat", annotations: [] },
          { type: "refusal", refusal: "brief refusal" },
        ],
      },
      {
        id: expect.stringMatching(/^fc_[a-f0-9]{32}$/),
        type: "function_call",
        status: "completed",
        call_id: "call_weather",
        name: "weather",
        arguments: '{"city":"Tokyo"}',
      },
    ]);
  });

  it("converts message items, images, function calls, and outputs", async () => {
    vi.spyOn(Config, "chatResponseMetadataEnabled").mockReturnValue(true);
    vi.mocked(handleChatCompletionsRequest).mockResolvedValue(
      Response.json({ choices: [{ finish_reason: "length", message: {} }] }),
    );
    const response = await handleResponsesRequest({
      request: request({
        model: "openai/model",
        input: [
          {
            role: "developer",
            content: [{ type: "input_text", text: "Developer guidance" }],
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Look" },
              {
                type: "input_image",
                image_url: "https://images.example/image.png",
                detail: "low",
              },
            ],
          },
          {
            role: "assistant",
            content: [{ type: "refusal", refusal: "No" }],
          },
          {
            type: "function_call",
            call_id: "call_1",
            name: "lookup",
            arguments: "{}",
          },
          {
            type: "function_call_output",
            call_id: "call_1",
            output: { value: 42 },
          },
        ],
        text: { format: { type: "json_object" } },
        tool_choice: "auto",
      }),
    } as never);

    const preparedRequest = vi.mocked(handleChatCompletionsRequest).mock
      .calls[0][2]!;
    expect(preparedRequest.body).toMatchObject({
      messages: [
        {
          role: "system",
          content: [{ type: "text", text: "Developer guidance" }],
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Look" },
            {
              type: "image_url",
              image_url: {
                url: "https://images.example/image.png",
                detail: "low",
              },
            },
          ],
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "No" }],
        },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "lookup", arguments: "{}" },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_1",
          content: '{"value":42}',
        },
      ],
      response_format: { type: "json_object" },
      tool_choice: "auto",
    });
    const converted = (await response.json()) as Record<string, any>;
    expect(converted.status).toBe("incomplete");
    expect(converted.incomplete_details).toEqual({
      reason: "max_output_tokens",
    });
    expect(converted.output).toEqual([
      expect.objectContaining({ type: "message", content: [] }),
    ]);
    expect(converted.usage).toBeNull();
  });

  it("converts Chat Completions text and function streaming chunks to Responses events", async () => {
    vi.spyOn(Config, "chatResponseMetadataEnabled").mockReturnValue(true);
    const sse = [
      'data: {"choices":[{"delta":{"content":"Hel"},"finish_reason":null}]}',
      "",
      'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":null}]}',
      "",
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"lookup","arguments":"{\\"q\\":"}}]},"finish_reason":null}]}',
      "",
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"x\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}',
      "",
      'data: {"id":"proxy-metadata","object":"chat.completion.chunk","choices":[],"llm_proxy":{"request_id":"request-stream","provider":"anthropic","model":"claude-sonnet-4-5","requested_model":"anthropic/model","credential_profile":"default","via_ai_gateway":true,"gateway":"production"}}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    vi.mocked(handleChatCompletionsRequest).mockResolvedValue(
      new Response(`${sse}\n`, {
        headers: {
          "content-type": "text/event-stream",
          "content-encoding": "gzip",
          digest: "stale",
        },
      }),
    );

    const response = await handleResponsesRequest({
      request: request({
        model: "anthropic/model",
        input: "Hello",
        stream: true,
      }),
    } as never);

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("digest")).toBeNull();
    const body = await response.text();
    const events = body
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
      "response.created",
      "response.in_progress",
      "response.output_item.added",
      "response.content_part.added",
      "response.output_text.delta",
      "response.output_text.delta",
      "response.output_item.added",
      "response.function_call_arguments.delta",
      "response.function_call_arguments.delta",
      "response.output_text.done",
      "response.content_part.done",
      "response.output_item.done",
      "response.function_call_arguments.done",
      "response.output_item.done",
      "response.completed",
    ]);
    expect(events.map((event) => event.sequence_number)).toEqual(
      events.map((_event, index) => index),
    );
    expect(
      events
        .filter((event) => event.type === "response.output_text.delta")
        .map((event) => event.delta)
        .join(""),
    ).toBe("Hello");
    expect(events.at(-1).response).toMatchObject({
      status: "completed",
      usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
      output: [
        expect.objectContaining({ type: "message" }),
        expect.objectContaining({
          type: "function_call",
          call_id: "call_1",
          name: "lookup",
          arguments: '{"q":"x"}',
        }),
      ],
      llm_proxy: {
        request_id: "request-stream",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        requested_model: "anthropic/model",
        credential_profile: "default",
        via_ai_gateway: true,
        gateway: "production",
      },
    });
    const preparedRequest = vi.mocked(handleChatCompletionsRequest).mock
      .calls[0][2]!;
    expect(preparedRequest.body).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    });
  });

  it("finishes an unterminated stream and reports invalid chunks", async () => {
    vi.mocked(handleChatCompletionsRequest).mockResolvedValue(
      new Response("data: not-json", {
        headers: { "content-type": "text/event-stream" },
      }),
    );

    const response = await handleResponsesRequest({
      request: request({ model: "openai/model", input: "Hello", stream: true }),
    } as never);
    const body = await response.text();
    expect(body).toContain("event: error");
    expect(body).toContain("event: response.completed");
  });

  it("passes upstream error responses through", async () => {
    vi.mocked(handleChatCompletionsRequest).mockResolvedValue(
      Response.json({ error: { message: "upstream" } }, { status: 429 }),
    );

    const response = await handleResponsesRequest({
      request: request({ model: "openai/model", input: "Hello" }),
    } as never);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: { message: "upstream" } });
  });

  it("uses safe defaults for partial Chat Completions output", async () => {
    const upstream = new Response(
      JSON.stringify({
        choices: [null, { message: { tool_calls: [null, { function: {} }] } }],
        usage: {},
      }),
    );
    upstream.headers.delete("content-type");
    vi.mocked(handleChatCompletionsRequest).mockResolvedValue(upstream);

    const response = await handleResponsesRequest({
      request: request({ model: "openai/model", input: "Hello" }),
    } as never);
    const converted = (await response.json()) as Record<string, any>;

    expect(converted).toMatchObject({
      status: "completed",
      instructions: null,
      max_output_tokens: null,
      metadata: {},
      parallel_tool_calls: true,
      reasoning: { effort: null, summary: null },
      service_tier: null,
      store: false,
      temperature: null,
      text: {},
      tool_choice: "auto",
      tools: [],
      top_p: null,
      truncation: "disabled",
      user: null,
      usage: {
        input_tokens: 0,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: 0,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: 0,
      },
    });
    expect(converted.output).toEqual([
      expect.objectContaining({
        type: "function_call",
        call_id: expect.stringMatching(/^fc_/),
        name: "",
        arguments: "",
      }),
    ]);
  });

  it.each([
    [
      "string message content",
      { input: [{ role: "user", content: "Hello" }] },
      { messages: [{ role: "user", content: "Hello" }] },
    ],
    [
      "minimal function tool",
      { input: "Hello", tools: [{ type: "function", name: "lookup" }] },
      {
        tools: [{ type: "function", function: { name: "lookup" } }],
      },
    ],
    [
      "image without detail",
      {
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_image",
                image_url: "https://images.example/a.png",
              },
            ],
          },
        ],
      },
      {
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: "https://images.example/a.png" },
              },
            ],
          },
        ],
      },
    ],
    [
      "text response format",
      { input: "Hello", text: { format: { type: "text" } } },
      { response_format: { type: "text" } },
    ],
    [
      "no text response format",
      { input: "Hello", text: {} },
      { messages: [{ role: "user", content: "Hello" }] },
    ],
    [
      "minimal JSON schema format",
      {
        input: "Hello",
        text: {
          format: {
            type: "json_schema",
            name: "answer",
            schema: { type: "object" },
          },
        },
      },
      {
        response_format: {
          type: "json_schema",
          json_schema: { name: "answer", schema: { type: "object" } },
        },
      },
    ],
    [
      "string and empty function output",
      {
        input: [
          { type: "function_call_output", call_id: "call_1", output: "ok" },
          { type: "function_call_output", call_id: "call_2", output: null },
        ],
      },
      {
        messages: [
          { role: "tool", tool_call_id: "call_1", content: "ok" },
          { role: "tool", tool_call_id: "call_2", content: '\"\"' },
        ],
      },
    ],
  ])("converts %s", async (_name, body, expected) => {
    vi.mocked(handleChatCompletionsRequest).mockResolvedValue(
      Response.json({ choices: [{ message: { content: "ok" } }] }),
    );

    await handleResponsesRequest({
      request: request({ model: "openai/model", ...body }),
    } as never);
    const preparedRequest = vi.mocked(handleChatCompletionsRequest).mock
      .calls[0][2]!;
    expect(preparedRequest.body).toMatchObject(expected);
  });

  it.each([
    ["invalid JSON", new Response("not-json")],
    ["invalid shape", Response.json({ choices: "invalid" })],
    [
      "missing body",
      new Response(null, { headers: { "content-type": "text/event-stream" } }),
    ],
  ])("returns 502 for %s upstream output", async (_name, upstream) => {
    vi.mocked(handleChatCompletionsRequest).mockResolvedValue(upstream);
    const response = await handleResponsesRequest({
      request: request({ model: "openai/model", input: "Hello" }),
    } as never);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "Upstream returned an invalid Chat Completions response.",
    });
  });

  it("converts an empty choices array", async () => {
    vi.mocked(handleChatCompletionsRequest).mockResolvedValue(
      Response.json({ choices: [] }),
    );
    const response = await handleResponsesRequest({
      request: request({ model: "openai/model", input: "Hello" }),
    } as never);
    expect((await response.json()) as Record<string, unknown>).toMatchObject({
      status: "completed",
      output: [expect.objectContaining({ type: "message", content: [] })],
    });
  });

  it("ignores malformed streaming fields and reports an incomplete result", async () => {
    const sse = [
      "data: null",
      "",
      'data: {"usage":{},"choices":"invalid"}',
      "",
      'data: {"choices":[null,{"delta":"invalid"},{"delta":{"tool_calls":"invalid"}}]}',
      "",
      'data: {"choices":[{"delta":{"tool_calls":[null,{"index":"bad"},{"index":1}]},"finish_reason":null}]}',
      "",
      'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"function":{"name":"later"}}]},"finish_reason":"length"}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    vi.mocked(handleChatCompletionsRequest).mockResolvedValue(
      new Response(sse, {
        headers: { "content-type": "text/event-stream" },
      }),
    );

    const response = await handleResponsesRequest({
      request: request({ model: "openai/model", input: "Hello", stream: true }),
    } as never);
    const body = await response.text();
    expect(body).toContain("event: response.incomplete");
    expect(body).toContain('"name":"later"');
    expect(body).toMatch(/"call_id":"fc_[a-f0-9]{32}"/);
  });

  it.each([
    ["malformed JSON", "{"],
    ["non-object", []],
    ["missing model", { input: "Hello" }],
    ["missing input", { model: "openai/model" }],
    [
      "invalid instructions",
      { model: "openai/model", input: "Hello", instructions: 1 },
    ],
    ["invalid input", { model: "openai/model", input: {} }],
    ["invalid input item", { model: "openai/model", input: [null] }],
    [
      "invalid role",
      { model: "openai/model", input: [{ role: "tool", content: "x" }] },
    ],
    [
      "invalid message content",
      { model: "openai/model", input: [{ role: "user", content: {} }] },
    ],
    [
      "invalid content item",
      { model: "openai/model", input: [{ role: "user", content: [null] }] },
    ],
    [
      "missing content text",
      {
        model: "openai/model",
        input: [{ role: "user", content: [{ type: "input_text" }] }],
      },
    ],
    [
      "image file id",
      {
        model: "openai/model",
        input: [
          {
            role: "user",
            content: [{ type: "input_image", file_id: "file_1" }],
          },
        ],
      },
    ],
    [
      "invalid function call id",
      {
        model: "openai/model",
        input: [{ type: "function_call", name: "f", arguments: "{}" }],
      },
    ],
    [
      "invalid function call name",
      {
        model: "openai/model",
        input: [{ type: "function_call", call_id: "c", arguments: "{}" }],
      },
    ],
    [
      "invalid function call arguments",
      {
        model: "openai/model",
        input: [{ type: "function_call", call_id: "c", name: "f" }],
      },
    ],
    [
      "invalid function output id",
      {
        model: "openai/model",
        input: [{ type: "function_call_output", output: "x" }],
      },
    ],
    [
      "unknown input item",
      { model: "openai/model", input: [{ type: "unknown" }] },
    ],
    ["unnamed input item", { model: "openai/model", input: [{}] }],
    ["invalid tools", { model: "openai/model", input: "Hello", tools: {} }],
    [
      "invalid tool item",
      { model: "openai/model", input: "Hello", tools: [null] },
    ],
    [
      "unnamed function tool",
      { model: "openai/model", input: "Hello", tools: [{ type: "function" }] },
    ],
    [
      "invalid tool choice",
      { model: "openai/model", input: "Hello", tool_choice: {} },
    ],
    ["invalid text", { model: "openai/model", input: "Hello", text: "text" }],
    [
      "invalid text format",
      { model: "openai/model", input: "Hello", text: { format: {} } },
    ],
    [
      "invalid JSON schema format",
      {
        model: "openai/model",
        input: "Hello",
        text: { format: { type: "json_schema" } },
      },
    ],
    [
      "invalid reasoning",
      { model: "openai/model", input: "Hello", reasoning: "high" },
    ],
    [
      "unknown reasoning field",
      {
        model: "openai/model",
        input: "Hello",
        reasoning: { effort: "high", summary: "auto" },
      },
    ],
    [
      "state reference",
      { model: "openai/model", input: "Hello", previous_response_id: "resp_1" },
    ],
    [
      "built-in tool",
      {
        model: "openai/model",
        input: "Hello",
        tools: [{ type: "web_search" }],
      },
    ],
    [
      "file input",
      {
        model: "openai/model",
        input: [
          {
            role: "user",
            content: [{ type: "input_file", file_id: "file_1" }],
          },
        ],
      },
    ],
    [
      "automatic truncation",
      { model: "openai/model", input: "Hello", truncation: "auto" },
    ],
    [
      "stateful storage",
      { model: "openai/model", input: "Hello", store: true },
    ],
    [
      "verbosity",
      { model: "openai/model", input: "Hello", text: { verbosity: "high" } },
    ],
  ])("rejects unsupported or invalid %s", async (_name, body) => {
    const response = await handleResponsesRequest({
      request: request(body),
    } as never);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: expect.any(String),
    });
    expect(handleChatCompletionsRequest).not.toHaveBeenCalled();
  });
});
