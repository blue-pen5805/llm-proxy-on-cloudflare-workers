import { describe, expect, it } from "vitest";
import {
  converseEndpoint,
  generateContentEndpoint,
  messagesEndpoint,
  transformNativeResponse,
} from "~/src/providers/native";
import type { NativeProtocol } from "~/src/providers/native_request";
import {
  convertNativeJson,
  nativeFinishReason,
  nativeMessage,
  nativeObjects,
  nativeUsage,
} from "~/src/providers/native_response";

const protocols: NativeProtocol[] = ["messages", "generateContent", "converse"];
const request = { model: "example", messages: [], max_tokens: 64 };

describe("native inference JSON responses", () => {
  it("converts Anthropic tools, finish reasons, and cached usage into Chat Completions", async () => {
    const source = Response.json(
      {
        id: "msg-123",
        content: [
          { type: "text", text: "Checking." },
          {
            type: "tool_use",
            id: "tool-1",
            name: "weather",
            input: { city: "Tokyo" },
          },
        ],
        stop_reason: "tool_use",
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 4,
          cache_creation_input_tokens: 2,
        },
      },
      {
        headers: {
          "content-length": "123",
          etag: "old",
          "cf-aig-cache-status": "HIT",
        },
      },
    );
    const response = await messagesEndpoint.transformResponse(
      source,
      "claude",
      request,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBeNull();
    expect(response.headers.get("etag")).toBeNull();
    expect(response.headers.get("cf-aig-cache-status")).toBe("HIT");
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({
      id: "msg-123",
      object: "chat.completion",
      created: expect.any(Number),
      model: "claude",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Checking.",
            tool_calls: [
              {
                id: "tool-1",
                type: "function",
                function: { name: "weather", arguments: '{"city":"Tokyo"}' },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: {
        prompt_tokens: 16,
        completion_tokens: 5,
        total_tokens: 21,
        prompt_tokens_details: { cached_tokens: 4 },
      },
    });
  });

  it("converts multiple Gemini candidates and preserves function thought signatures", async () => {
    const response = await generateContentEndpoint.transformResponse(
      Response.json({
        responseId: "gemini-response",
        candidates: [
          {
            index: 2,
            content: {
              parts: [
                { thought: true, text: "internal" },
                { text: "answer" },
                {
                  functionCall: { id: "call-1", name: "weather", args: {} },
                  thoughtSignature: "opaque-signature",
                },
              ],
            },
            finishReason: "STOP",
          },
          {
            content: { parts: [{ text: "alternative" }] },
            finishReason: "MAX_TOKENS",
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          thoughtsTokenCount: 3,
          cachedContentTokenCount: 2,
        },
      }),
      "gemini",
      request,
    );
    expect(await response.json()).toEqual({
      id: "gemini-response",
      object: "chat.completion",
      created: expect.any(Number),
      model: "gemini",
      choices: [
        {
          index: 2,
          message: {
            role: "assistant",
            content: "answer",
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: { name: "weather", arguments: "{}" },
                extra_content: {
                  google: { thought_signature: "opaque-signature" },
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
        {
          index: 1,
          message: { role: "assistant", content: "alternative" },
          finish_reason: "length",
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 8,
        total_tokens: 18,
        prompt_tokens_details: { cached_tokens: 2 },
      },
    });
  });

  it("converts Converse tools and usage", async () => {
    const response = await converseEndpoint.transformResponse(
      Response.json({
        output: {
          message: {
            content: [
              { text: "hello" },
              { toolUse: { toolUseId: "tool-1", name: "f", input: {} } },
            ],
          },
        },
        stopReason: "tool_use",
        usage: {
          inputTokens: 10,
          outputTokens: 4,
          cacheReadInputTokens: 2,
          cacheWriteInputTokens: 3,
        },
      }),
      "nova",
      request,
    );
    expect(await response.json()).toMatchObject({
      id: expect.stringMatching(/^chatcmpl_/),
      model: "nova",
      choices: [
        {
          index: 0,
          message: {
            content: "hello",
            tool_calls: [
              { id: "tool-1", function: { name: "f", arguments: "{}" } },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: {
        prompt_tokens: 15,
        completion_tokens: 4,
        total_tokens: 19,
        prompt_tokens_details: { cached_tokens: 2 },
      },
    });
  });

  it("represents Gemini prompt blocking without treating it as malformed JSON", () => {
    expect(
      convertNativeJson(
        { promptFeedback: { blockReason: "SAFETY" } },
        "generateContent",
        "gemini",
      ),
    ).toMatchObject({
      choices: [
        {
          message: { role: "assistant", content: null },
          finish_reason: "content_filter",
        },
      ],
    });
    expect(
      convertNativeJson(
        { candidates: [{ finishReason: "SAFETY" }] },
        "generateContent",
        "gemini",
      ),
    ).toMatchObject({
      choices: [
        { message: { content: null }, finish_reason: "content_filter" },
      ],
    });
  });

  it.each([
    "max_tokens",
    "MAX_TOKENS",
    "tool_use",
    "SAFETY",
    "RECITATION",
    "refusal",
    "guardrail_intervened",
    "content_filtered",
    "end_turn",
    undefined,
  ])("maps finish reason %s", (reason) => {
    const expected =
      reason === "max_tokens" || reason === "MAX_TOKENS"
        ? "length"
        : reason === "tool_use"
          ? "tool_calls"
          : [
                "SAFETY",
                "RECITATION",
                "refusal",
                "guardrail_intervened",
                "content_filtered",
              ].includes(reason as string)
            ? "content_filter"
            : "stop";
    expect(nativeFinishReason(reason)).toBe(expected);
  });

  it.each(protocols)(
    "uses zero usage counts when %s omits usage",
    (protocol) => {
      expect(nativeUsage({}, protocol)).toEqual({
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        prompt_tokens_details: { cached_tokens: 0 },
      });
      expect(nativeMessage([], protocol)).toEqual({
        role: "assistant",
        content: null,
      });
    },
  );

  it("uses empty argument objects and generated IDs when native function calls omit them", () => {
    for (const [protocol, part] of [
      ["messages", { type: "tool_use", name: "f" }],
      ["generateContent", { functionCall: { name: "f" } }],
      ["converse", { toolUse: { name: "f" } }],
    ] as const) {
      expect(nativeMessage([part], protocol)).toMatchObject({
        tool_calls: [
          {
            id: expect.stringMatching(/^call_/),
            function: { arguments: "{}" },
          },
        ],
      });
    }
  });

  it.each([401, 429, 500])(
    "preserves upstream HTTP %i responses and bodies",
    async (status) => {
      const response = new Response("upstream error", { status });
      expect(
        await transformNativeResponse(response, "messages", "m", request),
      ).toBe(response);
      expect(await response.text()).toBe("upstream error");
    },
  );

  it.each(["not-json", "null", "[]", '{"content":{}}', '{"content":[null]}'])(
    "returns a bounded generic error for an invalid native body: %s",
    async (body) => {
      const response = await transformNativeResponse(
        new Response(body),
        "messages",
        "m",
        request,
      );
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({
        error: {
          message: "Upstream returned an invalid native inference response.",
          type: "api_error",
        },
      });
    },
  );

  it("rejects oversized JSON and missing streaming bodies", async () => {
    const large = new Response('"' + "x".repeat(5 * 1024 * 1024) + '"');
    expect(
      (await transformNativeResponse(large, "messages", "m", request)).status,
    ).toBe(502);
    expect(
      (
        await transformNativeResponse(
          new Response(null, {
            headers: { "content-type": "text/event-stream" },
          }),
          "messages",
          "m",
          request,
        )
      ).status,
    ).toBe(502);
    expect(() => nativeObjects({})).toThrow("array");
  });
});

describe("native endpoint definitions", () => {
  it("declares Messages and encodes Gemini model names without accepting arbitrary URLs", () => {
    expect(messagesEndpoint.prepare(request).path).toBe("/v1/messages");
    expect(
      generateContentEndpoint.prepare({ ...request, model: "models/example" })
        .path,
    ).toBe("/v1beta/models/example:generateContent");
    expect(
      generateContentEndpoint.prepare({
        ...request,
        model: "model/with?query#fragment",
        stream: true,
      }).path,
    ).toBe(
      "/v1beta/models/model%2Fwith%3Fquery%23fragment:streamGenerateContent?alt=sse",
    );
    expect(
      converseEndpoint.prepare({ ...request, model: "us.anthropic.claude:0" })
        .path,
    ).toBe("/model/us.anthropic.claude%3A0/converse");
    expect(converseEndpoint.prepare({ ...request, stream: true }).path).toBe(
      "/model/example/converse-stream",
    );
  });
});
