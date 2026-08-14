import { beforeEach, describe, expect, it, vi } from "vitest";
import { CloudflareAIGateway } from "~/src/ai_gateway";
import { handleChatCompletionsRequest } from "~/src/requests/chat_completions";
import { handleResponsesRequest } from "~/src/requests/responses";
import {
  convertResponsesRequest,
  SUPPORTED_REQUEST_FIELDS,
} from "~/src/requests/responses/request";
import {
  MAX_SSE_RECORD_BYTES,
  MAX_STREAM_TEXT_BYTES,
  MAX_STREAM_TOOL_ARGUMENT_BYTES,
  MAX_STREAM_TOOL_METADATA_BYTES,
} from "~/src/requests/stream_limits";
import { Config } from "~/src/utils/config";
import { PayloadTooLargeError } from "~/src/utils/error";

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

  it("declares the top-level fields converted to Chat Completions", () => {
    expect([...SUPPORTED_REQUEST_FIELDS]).toEqual([
      "frequency_penalty",
      "include",
      "input",
      "instructions",
      "logprobs",
      "max_output_tokens",
      "metadata",
      "model",
      "moderation",
      "parallel_tool_calls",
      "presence_penalty",
      "prompt_cache_key",
      "prompt_cache_options",
      "prompt_cache_retention",
      "reasoning",
      "safety_identifier",
      "seed",
      "service_tier",
      "store",
      "stream",
      "stream_options",
      "temperature",
      "text",
      "tool_choice",
      "tools",
      "top_logprobs",
      "top_p",
      "user",
    ]);
    expect(
      convertResponsesRequest({
        model: "openai/model",
        input: "hello",
        future_option: true,
      }).request,
    ).toEqual({ model: "openai/model", input: "hello" });
  });

  it("converts requested logprobs and omits an empty allowed-tools choice", () => {
    const converted = convertResponsesRequest({
      model: "openai/model",
      input: "hello",
      include: ["reasoning.encrypted_content", "message.output_text.logprobs"],
      tools: [{ type: "web_search" }],
      tool_choice: {
        type: "allowed_tools",
        mode: "required",
        tools: [{ type: "web_search" }],
      },
    });

    expect(converted.chat).toMatchObject({ logprobs: true });
    expect(converted.chat).not.toHaveProperty("tools");
    expect(converted.chat).not.toHaveProperty("tool_choice");

    const nullableTopLogprobs = convertResponsesRequest({
      model: "openai/model",
      input: "hello",
      top_logprobs: null,
    });
    expect(nullableTopLogprobs.chat).toMatchObject({ top_logprobs: null });
    expect(nullableTopLogprobs.chat).not.toHaveProperty("logprobs");
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
              logprobs: {
                content: [
                  {
                    token: "Hello",
                    bytes: [72],
                    logprob: -0.1,
                    top_logprobs: [
                      {
                        token: "Hello",
                        bytes: null,
                        logprob: -0.1,
                      },
                      null,
                    ],
                  },
                  {
                    token: " world",
                    bytes: null,
                    logprob: -0.3,
                  },
                  null,
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
      reasoning: {
        effort: "medium",
        summary: "auto",
        context: "all_turns",
        future_option: { enabled: true },
      },
      max_output_tokens: 200,
      metadata: { tenant: "example" },
      parallel_tool_calls: false,
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
      expect.objectContaining({
        endpoint: "responses",
        responseMetadataEnabled: true,
      }),
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
      logprobs: true,
      metadata: { tenant: "example" },
      parallel_tool_calls: false,
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
          {
            type: "output_text",
            text: "Hello from chat",
            annotations: [],
            logprobs: [
              {
                token: "Hello",
                bytes: [72],
                logprob: -0.1,
                top_logprobs: [
                  {
                    token: "Hello",
                    bytes: [72, 101, 108, 108, 111],
                    logprob: -0.1,
                  },
                ],
              },
              {
                token: " world",
                bytes: [32, 119, 111, 114, 108, 100],
                logprob: -0.3,
                top_logprobs: [],
              },
            ],
          },
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
            content: [
              {
                type: "input_text",
                text: "Developer guidance",
                prompt_cache_breakpoint: { mode: "explicit" },
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Look",
                prompt_cache_breakpoint: { mode: "explicit" },
              },
              { type: "text", text: "Again" },
              {
                type: "input_image",
                image_url: "https://images.example/image.png",
                detail: "low",
                prompt_cache_breakpoint: { mode: "explicit" },
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
          content: [
            {
              type: "text",
              text: "Developer guidance",
              prompt_cache_breakpoint: { mode: "explicit" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Look",
              prompt_cache_breakpoint: { mode: "explicit" },
            },
            { type: "text", text: "Again" },
            {
              type: "image_url",
              image_url: {
                url: "https://images.example/image.png",
                detail: "low",
              },
              prompt_cache_breakpoint: { mode: "explicit" },
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

  it("converts nested file, custom-tool, allowed-tool, and verbosity fields", async () => {
    vi.mocked(handleChatCompletionsRequest).mockResolvedValue(
      Response.json({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: "call_custom",
                  type: "custom",
                  custom: { name: "shell", input: "echo ok" },
                },
              ],
            },
          },
        ],
      }),
    );

    const response = await handleResponsesRequest({
      request: request({
        model: "openai/model",
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_file",
                file_id: "file_1",
                prompt_cache_breakpoint: { mode: "explicit" },
              },
              {
                type: "input_file",
                file_data: "ZmlsZQ==",
                filename: "input.txt",
              },
              {
                type: "input_image",
                image_url: "https://images.example/original.png",
                detail: "auto",
              },
              { type: "future_content", payload: "ignored" },
              { type: "input_file", file_url: "https://files.example/a" },
            ],
          },
          {
            type: "custom_tool_call",
            call_id: "call_custom",
            name: "shell",
            input: "echo prior",
          },
          {
            type: "custom_tool_call_output",
            call_id: "call_custom",
            output: "prior output",
          },
          {
            type: "function_call_output",
            call_id: "call_function",
            output: [{ type: "input_text", text: "function output" }],
          },
        ],
        tools: [
          { type: "web_search" },
          { type: "function", name: "lookup", strict: null },
          {
            type: "custom",
            name: "shell",
            description: "Run a command",
            format: { type: "text" },
          },
        ],
        tool_choice: {
          type: "allowed_tools",
          mode: "required",
          tools: [
            { type: "web_search" },
            { type: "function", name: "lookup" },
            { type: "custom", name: "shell" },
          ],
        },
        text: { verbosity: "high" },
        max_tool_calls: 2,
        future_option: true,
      }),
    } as never);

    const preparedRequest = vi.mocked(handleChatCompletionsRequest).mock
      .calls[0][2]!;
    expect(preparedRequest.body).toEqual({
      model: "openai/model",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "file",
              file: { file_id: "file_1" },
              prompt_cache_breakpoint: { mode: "explicit" },
            },
            {
              type: "file",
              file: { file_data: "ZmlsZQ==", filename: "input.txt" },
            },
            {
              type: "image_url",
              image_url: {
                url: "https://images.example/original.png",
                detail: "auto",
              },
            },
          ],
        },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_custom",
              type: "custom",
              custom: { name: "shell", input: "echo prior" },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_custom",
          content: "prior output",
        },
        {
          role: "tool",
          tool_call_id: "call_function",
          content: [{ type: "text", text: "function output" }],
        },
      ],
      tools: [
        {
          type: "function",
          function: { name: "lookup", strict: null },
        },
        {
          type: "custom",
          custom: {
            name: "shell",
            description: "Run a command",
            format: { type: "text" },
          },
        },
      ],
      tool_choice: {
        type: "allowed_tools",
        allowed_tools: {
          mode: "required",
          tools: [
            { type: "function", function: { name: "lookup" } },
            { type: "custom", custom: { name: "shell" } },
          ],
        },
      },
      verbosity: "high",
    });
    await expect(response.json()).resolves.toMatchObject({
      output: [
        {
          type: "custom_tool_call",
          call_id: "call_custom",
          name: "shell",
          input: "echo ok",
        },
      ],
    });
  });

  it("converts streamed custom-tool input to Responses events", async () => {
    const sse = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_custom","type":"custom","custom":{"name":"shell","input":"echo "}}]},"finish_reason":null}]}',
      "",
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"custom":{"input":"ok"}}]},"finish_reason":"tool_calls"}]}',
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

    expect(body).toContain("event: response.custom_tool_call_input.delta");
    expect(body).toContain("event: response.custom_tool_call_input.done");
    expect(body).toContain('"type":"custom_tool_call"');
    expect(body).toContain('"input":"echo ok"');
  });

  it("ignores Responses fields without a supported Chat Completions conversion", async () => {
    vi.mocked(handleChatCompletionsRequest).mockResolvedValue(
      Response.json({ choices: [{ message: { content: "ok" } }] }),
    );

    const response = await handleResponsesRequest({
      request: request({
        model: "openai/model",
        input: "Hello",
        background: true,
        context_management: [{ type: "compaction", compact_threshold: 1000 }],
        conversation: "conv_1",
        include: ["reasoning.encrypted_content"],
        moderation: { type: "omni-moderation-latest" },
        previous_response_id: "resp_1",
        prompt: { id: "pmpt_1", variables: { topic: "weather" } },
        prompt_cache_key: "tenant-1",
        prompt_cache_options: { mode: "explicit", ttl: "30m" },
        prompt_cache_retention: "24h",
        safety_identifier: "hashed-user-1",
        stream_options: { include_obfuscation: false },
        truncation: "auto",
        reasoning: {
          summary: "auto",
          context: "all_turns",
          future_option: { enabled: true },
        },
      }),
    } as never);

    const preparedRequest = vi.mocked(handleChatCompletionsRequest).mock
      .calls[0][2]!;
    expect(preparedRequest.body).toEqual({
      model: "openai/model",
      messages: [{ role: "user", content: "Hello" }],
      moderation: { type: "omni-moderation-latest" },
      prompt_cache_key: "tenant-1",
      prompt_cache_options: { mode: "explicit", ttl: "30m" },
      prompt_cache_retention: "24h",
      safety_identifier: "hashed-user-1",
    });
    await expect(response.json()).resolves.toMatchObject({
      background: false,
      previous_response_id: null,
      truncation: "disabled",
    });
  });

  it("converts Chat Completions text and function streaming chunks to Responses events", async () => {
    vi.spyOn(Config, "chatResponseMetadataEnabled").mockReturnValue(true);
    const sse = [
      'data: {"choices":[{"delta":{"content":"Hel"},"finish_reason":null,"logprobs":{"content":[{"token":"Hel","bytes":[72,101,108],"logprob":-0.1,"top_logprobs":[{"token":"Hello","bytes":[72,"bad"],"logprob":-0.2}]}]}}],"obfuscation":"text-pad-1"}',
      "",
      'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":null}],"obfuscation":"text-pad-2"}',
      "",
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"lookup","arguments":"{\\"q\\":"}}]},"finish_reason":null}],"obfuscation":"tool-pad-1"}',
      "",
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"x\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5},"obfuscation":"tool-pad-2"}',
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
        stream_options: { include_obfuscation: false },
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
    const textDeltas = events.filter(
      (event) => event.type === "response.output_text.delta",
    );
    expect(textDeltas[0].logprobs).toEqual([
      {
        token: "Hel",
        logprob: -0.1,
        top_logprobs: [{ token: "Hello", logprob: -0.2 }],
      },
    ]);
    expect(textDeltas[1].logprobs).toEqual([]);
    expect(textDeltas.map((event) => event.obfuscation)).toEqual([
      undefined,
      undefined,
    ]);
    expect(
      events
        .filter(
          (event) => event.type === "response.function_call_arguments.delta",
        )
        .map((event) => event.obfuscation),
    ).toEqual([undefined, undefined]);
    expect(
      events.find((event) => event.type === "response.output_text.done")
        .logprobs,
    ).toEqual([
      {
        token: "Hel",
        logprob: -0.1,
        top_logprobs: [{ token: "Hello", logprob: -0.2 }],
      },
    ]);
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
      stream_options: { include_obfuscation: false, include_usage: true },
    });
  });

  it("emits upstream obfuscation at most once per Chat chunk", async () => {
    const obfuscation = "x".repeat(64 * 1024);
    const choices = Array.from({ length: 128 }, (_value, index) => ({
      delta: { content: String(index % 10) },
      finish_reason: null,
    }));
    const sse = [
      `data: ${JSON.stringify({ choices, obfuscation })}`,
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
      request: request({
        model: "openai/model",
        input: "Hello",
        stream: true,
      }),
    } as never);
    const body = await response.text();

    expect(body.split('"obfuscation":').length - 1).toBe(1);
    expect(body.split("event: response.output_text.delta").length - 1).toBe(
      choices.length,
    );
    expect(body.length).toBeLessThan(obfuscation.length + 256 * 1024);
  });

  it("terminates malformed streams without emitting a successful completion", async () => {
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

    const response = await handleResponsesRequest({
      request: request({ model: "openai/model", input: "Hello", stream: true }),
    } as never);
    const body = await response.text();
    expect(body).toContain("event: error");
    expect(body).toContain('"code":"stream_error"');
    expect(body).toContain('"param":null');
    expect(body).not.toContain('"error":{"type":"stream_error"');
    expect(body).not.toContain("event: response.completed");
    expect(body).not.toContain("event: response.incomplete");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("terminates a stream when cumulative text exceeds its byte budget", async () => {
    const delta = "x".repeat(900 * 1024);
    const sse = Array.from(
      { length: Math.ceil(MAX_STREAM_TEXT_BYTES / delta.length) + 1 },
      () =>
        `data: ${JSON.stringify({
          choices: [{ delta: { content: delta }, finish_reason: null }],
        })}\n\n`,
    ).join("");
    const cancel = vi.fn();
    let sent = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) return;
        sent = true;
        controller.enqueue(new TextEncoder().encode(sse));
      },
      cancel,
    });
    vi.mocked(handleChatCompletionsRequest).mockResolvedValue(
      new Response(stream, {
        headers: { "content-type": "text/event-stream" },
      }),
    );

    const response = await handleResponsesRequest({
      request: request({ model: "openai/model", input: "Hello", stream: true }),
    } as never);
    const body = await response.text();

    expect(body).toContain("Streaming text exceeds the proxy limit.");
    expect(body).not.toContain("event: response.completed");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("enforces independent tool-argument, tool-count, output-item, and tool-metadata budgets", async () => {
    const argumentDelta = "x".repeat(900 * 1024);
    const toolCalls = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        index,
        id: `call_${index}`,
        function: { name: "lookup", arguments: "" },
      }));
    const cases = [
      {
        expected: "Streaming tool arguments exceed the proxy limit.",
        sse: Array.from(
          {
            length:
              Math.ceil(MAX_STREAM_TOOL_ARGUMENT_BYTES / argumentDelta.length) +
              1,
          },
          (_, index) =>
            `data: ${JSON.stringify({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        ...(index === 0
                          ? { id: "call_0", function: { name: "lookup" } }
                          : {}),
                        function: {
                          ...(index === 0 ? { name: "lookup" } : {}),
                          arguments: argumentDelta,
                        },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
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
      {
        expected: "Streaming tool metadata exceeds the proxy limit.",
        sse:
          `data: ${JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_0",
                      function: { name: "lookup", arguments: "" },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          })}\n\n` +
          `data: ${JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      function: {
                        name: "x".repeat(MAX_STREAM_TOOL_METADATA_BYTES + 1),
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
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
      const response = await handleResponsesRequest({
        request: request({
          model: "openai/model",
          input: "Hello",
          stream: true,
        }),
      } as never);
      const body = await response.text();
      expect(body).toContain(testCase.expected);
      expect(body).not.toContain("event: response.completed");
      expect(body).not.toContain("event: response.incomplete");
    }
  });

  it("rejects oversized complete and unterminated SSE records", async () => {
    for (const suffix of ["\n\n", ""]) {
      vi.mocked(handleChatCompletionsRequest).mockResolvedValue(
        new Response(`data: ${"x".repeat(MAX_SSE_RECORD_BYTES + 1)}${suffix}`, {
          headers: { "content-type": "text/event-stream" },
        }),
      );
      const response = await handleResponsesRequest({
        request: request({
          model: "openai/model",
          input: "Hello",
          stream: true,
        }),
      } as never);
      const body = await response.text();
      expect(body).toContain("Upstream SSE record exceeds the proxy limit.");
      expect(body).not.toContain("event: response.completed");
    }
  });

  it("turns invalid UTF-8 during transform or flush into a terminal error", async () => {
    for (const bytes of [new Uint8Array([0xff]), new Uint8Array([0xc3])]) {
      vi.mocked(handleChatCompletionsRequest).mockResolvedValue(
        new Response(bytes, {
          headers: { "content-type": "text/event-stream" },
        }),
      );
      const response = await handleResponsesRequest({
        request: request({
          model: "openai/model",
          input: "Hello",
          stream: true,
        }),
      } as never);
      const body = await response.text();
      expect(body).toContain("invalid UTF-8");
      expect(body).not.toContain("event: response.completed");
    }
  });

  const streamResponse = async (upstream: string) => {
    vi.mocked(handleChatCompletionsRequest).mockResolvedValue(
      new Response(upstream, {
        headers: { "content-type": "text/event-stream" },
      }),
    );
    const response = await handleResponsesRequest({
      request: request({
        model: "openai/model",
        input: "Hello",
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
    expect(body).toContain("event: response.completed");
  });

  it("ignores a non-data SSE record and completes a terminated empty response", async () => {
    const body = await streamResponse("event: ping\n\ndata: [DONE]\n\n");

    expect(body).toContain("event: response.completed");
    expect(body).not.toContain("event: response.output_item.added");
  });

  it("ignores a final non-data record before reporting truncation", async () => {
    const body = await streamResponse("event: ping");
    expect(body).toContain("Upstream stream ended without a terminal event.");
  });

  it("fails a stream that ends before its terminal event", async () => {
    const body = await streamResponse(
      `data: ${JSON.stringify({
        choices: [{ delta: { content: "par" } }],
      })}\n\n`,
    );

    expect(body).toContain("event: error");
    expect(body).toContain("Upstream stream ended without a terminal event.");
    expect(body).not.toContain("event: response.completed");
    expect(body).not.toContain("event: response.incomplete");
  });

  it("fails an upstream stream that carries no event at all", async () => {
    const body = await streamResponse("");

    expect(body).toContain("event: response.created");
    expect(body).toContain("event: error");
    expect(body).not.toContain("event: response.completed");
  });

  it("joins the data lines of one SSE record into a single payload", async () => {
    const body = await streamResponse(
      'data: {"choices":[{"delta":\ndata: {"content":"split"}}]}\n\ndata: [DONE]\n\n',
    );

    expect(body).toContain('"delta":"split"');
    expect(body).toContain("event: response.completed");
  });

  it("preserves payload-too-large errors from bounded request parsing", async () => {
    const oversized = new Request("https://proxy.example/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(10 * 1024 * 1024 + 1),
      },
      body: "{}",
    });

    await expect(
      handleResponsesRequest({ request: oversized } as never),
    ).rejects.toBeInstanceOf(PayloadTooLargeError);
    expect(handleChatCompletionsRequest).not.toHaveBeenCalled();
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
        choices: [
          null,
          {
            message: {
              tool_calls: [
                null,
                {},
                { function: {} },
                { type: "custom", custom: {} },
              ],
            },
          },
        ],
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
      expect.objectContaining({
        type: "custom_tool_call",
        call_id: expect.stringMatching(/^ctc_/),
        name: "",
        input: "",
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
      "minimal custom tool",
      { input: "Hello", tools: [{ type: "custom", name: "shell" }] },
      {
        tools: [{ type: "custom", custom: { name: "shell" } }],
      },
    ],
    [
      "named custom tool choice",
      {
        input: "Hello",
        tool_choice: { type: "custom", name: "shell" },
      },
      {
        tool_choice: { type: "custom", custom: { name: "shell" } },
      },
    ],
    [
      "null verbosity",
      { input: "Hello", text: { verbosity: null }, stream_options: null },
      { verbosity: null },
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
      "image with null detail",
      {
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_image",
                image_url: "https://images.example/null-detail.png",
                detail: null,
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
                image_url: {
                  url: "https://images.example/null-detail.png",
                },
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
    [
      "prior output text",
      {
        input: [
          {
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: "prior",
                annotations: [],
                logprobs: [],
              },
            ],
          },
        ],
      },
      {
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: "prior" }],
          },
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
      error: expect.objectContaining({
        message: "Upstream returned an invalid Chat Completions response.",
      }),
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

  const ignoredCompatibilityCases = new Set([
    "removed Responses field",
    "unknown stream option",
    "invalid role",
    "unknown content item",
    "invalid prompt-cache breakpoint",
    "image file id",
    "unsupported image detail",
    "file URL without a Chat representation",
    "file detail without a Chat representation",
    "invalid custom tool output item",
    "unknown input item",
    "unnamed input item",
    "invalid tool item",
    "invalid tool choice",
    "invalid allowed tool choice mode",
    "invalid allowed tool choice item",
    "invalid text format",
    "invalid JSON schema format",
    "built-in tool",
    "stateful storage",
    "verbosity",
  ]);

  it.each([
    ["malformed JSON", "{"],
    ["non-object", []],
    ["missing model", { input: "Hello" }],
    ["missing input", { model: "openai/model" }],
    [
      "removed Responses field",
      { model: "openai/model", input: "Hello", max_tool_calls: 1 },
    ],
    [
      "invalid instructions",
      { model: "openai/model", input: "Hello", instructions: 1 },
    ],
    ["invalid input", { model: "openai/model", input: {} }],
    [
      "invalid stream options",
      { model: "openai/model", input: "Hello", stream_options: false },
    ],
    [
      "unknown stream option",
      {
        model: "openai/model",
        input: "Hello",
        stream_options: { unknown: true },
      },
    ],
    [
      "invalid stream obfuscation option",
      {
        model: "openai/model",
        input: "Hello",
        stream_options: { include_obfuscation: "no" },
      },
    ],
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
      "unknown content item",
      {
        model: "openai/model",
        input: [{ role: "user", content: [{ type: "unknown" }] }],
      },
    ],
    [
      "missing content text",
      {
        model: "openai/model",
        input: [{ role: "user", content: [{ type: "input_text" }] }],
      },
    ],
    [
      "invalid prompt-cache breakpoint",
      {
        model: "openai/model",
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: "x",
                prompt_cache_breakpoint: { mode: "explicit", extra: true },
              },
            ],
          },
        ],
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
      "unsupported image detail",
      {
        model: "openai/model",
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_image",
                image_url: "https://images.example/image.png",
                detail: "original",
              },
            ],
          },
        ],
      },
    ],
    [
      "file URL without a Chat representation",
      {
        model: "openai/model",
        input: [
          {
            role: "user",
            content: [
              { type: "input_file", file_url: "https://files.example" },
            ],
          },
        ],
      },
    ],
    [
      "file detail without a Chat representation",
      {
        model: "openai/model",
        input: [
          {
            role: "user",
            content: [
              { type: "input_file", file_id: "file_1", detail: "full" },
            ],
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
      "invalid custom tool call",
      {
        model: "openai/model",
        input: [{ type: "custom_tool_call", call_id: "c", name: "shell" }],
      },
    ],
    [
      "invalid custom tool output item",
      {
        model: "openai/model",
        input: [
          {
            type: "custom_tool_call_output",
            call_id: "c",
            output: [
              { type: "input_image", image_url: "https://image.example" },
            ],
          },
        ],
      },
    ],
    [
      "invalid custom tool output text",
      {
        model: "openai/model",
        input: [
          {
            type: "custom_tool_call_output",
            call_id: "c",
            output: [{ type: "input_text" }],
          },
        ],
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
      "unnamed custom tool",
      { model: "openai/model", input: "Hello", tools: [{ type: "custom" }] },
    ],
    [
      "invalid custom tool format",
      {
        model: "openai/model",
        input: "Hello",
        tools: [{ type: "custom", name: "shell", format: "text" }],
      },
    ],
    [
      "invalid tool choice",
      { model: "openai/model", input: "Hello", tool_choice: {} },
    ],
    [
      "invalid allowed tool choice mode",
      {
        model: "openai/model",
        input: "Hello",
        tool_choice: { type: "allowed_tools", mode: "sometimes", tools: [] },
      },
    ],
    [
      "invalid allowed tool choice item",
      {
        model: "openai/model",
        input: "Hello",
        tool_choice: {
          type: "allowed_tools",
          mode: "auto",
          tools: [{ type: "web_search" }],
        },
      },
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
      "built-in tool",
      {
        model: "openai/model",
        input: "Hello",
        tools: [{ type: "web_search" }],
      },
    ],
    [
      "stateful storage",
      { model: "openai/model", input: "Hello", store: true },
    ],
    [
      "verbosity",
      { model: "openai/model", input: "Hello", text: { verbosity: "extreme" } },
    ],
  ])("handles unsupported or invalid %s", async (name, body) => {
    const ignored = ignoredCompatibilityCases.has(name);
    if (ignored) {
      vi.mocked(handleChatCompletionsRequest).mockResolvedValue(
        Response.json({ choices: [{ message: { content: "ok" } }] }),
      );
    }
    const response = await handleResponsesRequest({
      request: request(body),
    } as never);
    if (ignored) {
      expect(response.status).toBe(200);
      expect(handleChatCompletionsRequest).toHaveBeenCalledOnce();
    } else {
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: expect.objectContaining({
          message: expect.any(String),
          type: "invalid_request_error",
        }),
      });
      expect(handleChatCompletionsRequest).not.toHaveBeenCalled();
    }
  });
});
