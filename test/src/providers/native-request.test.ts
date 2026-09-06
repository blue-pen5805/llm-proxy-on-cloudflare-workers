import { describe, expect, it } from "vitest";
import {
  prepareNativeRequest,
  type NativeProtocol,
} from "~/src/providers/native_request";
import { BadRequestError } from "~/src/utils/error";

const protocols: NativeProtocol[] = ["messages", "generateContent", "converse"];
const base = {
  model: "example-model",
  messages: [{ role: "user", content: "hello" }],
  max_tokens: 32,
};
const schema = { type: "object", properties: { city: { type: "string" } } };

describe("native inference request conversion", () => {
  it("maps Messages instructions, tool history, images and sampling fields", () => {
    const result = prepareNativeRequest(
      {
        ...base,
        messages: [
          { role: "system", content: "system" },
          { role: "developer", content: [{ type: "text", text: "developer" }] },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: "data:image/png;base64,aGVsbG8=" },
              },
              {
                type: "image_url",
                image_url: { url: "https://example.test/image.png" },
              },
            ],
          },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                type: "function",
                id: "call-1",
                function: { name: "weather", arguments: '{"city":"Tokyo"}' },
              },
            ],
          },
          { role: "tool", tool_call_id: "call-1", content: "sunny" },
        ],
        max_completion_tokens: 64,
        stream: true,
        temperature: 0.5,
        top_p: 0.9,
        stop: "end",
        n: 1,
        tools: [
          {
            type: "function",
            function: {
              name: "weather",
              description: "Forecast",
              parameters: schema,
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "weather" } },
        parallel_tool_calls: false,
        response_format: {
          type: "json_schema",
          json_schema: { name: "output", schema },
        },
      },
      "messages",
    );
    expect(result).toEqual({
      model: "example-model",
      max_tokens: 64,
      stream: true,
      temperature: 0.5,
      top_p: 0.9,
      stop_sequences: ["end"],
      system: [
        { type: "text", text: "system" },
        { type: "text", text: "developer" },
      ],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: "aGVsbG8=",
              },
            },
            {
              type: "image",
              source: { type: "url", url: "https://example.test/image.png" },
            },
          ],
        },
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "call-1",
              name: "weather",
              input: { city: "Tokyo" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "call-1",
              content: [{ type: "text", text: "sunny" }],
            },
          ],
        },
      ],
      tools: [
        { name: "weather", description: "Forecast", input_schema: schema },
      ],
      tool_choice: {
        type: "tool",
        name: "weather",
        disable_parallel_tool_use: true,
      },
      output_config: { format: { type: "json_schema", schema } },
    });
  });

  it("maps Gemini function names, results and thought signatures without mutating the input", () => {
    const data = {
      ...base,
      max_completion_tokens: 64,
      temperature: 0.2,
      top_p: 0.8,
      n: 2,
      stop: ["done"],
      messages: [
        { role: "system", content: "instructions" },
        {
          role: "user",
          content: [
            { type: "text", text: "photo" },
            {
              type: "image_url",
              image_url: { url: "data:image/jpeg;base64,aA==" },
            },
          ],
        },
        {
          role: "assistant",
          tool_calls: [
            {
              type: "function",
              id: "call-1",
              function: { name: "weather", arguments: "{}" },
              extra_content: {
                google: { thought_signature: "opaque-signature" },
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call-1",
          content: '{"forecast":"sunny"}',
        },
      ],
      tools: [{ type: "function", function: { name: "weather" } }],
      tool_choice: "required",
      response_format: { type: "json_object" },
    };
    const original = structuredClone(data);
    expect(prepareNativeRequest(data, "generateContent")).toEqual({
      systemInstruction: { parts: [{ text: "instructions" }] },
      contents: [
        {
          role: "user",
          parts: [
            { text: "photo" },
            { inlineData: { mimeType: "image/jpeg", data: "aA==" } },
          ],
        },
        {
          role: "model",
          parts: [
            {
              functionCall: { name: "weather", id: "call-1", args: {} },
              thoughtSignature: "opaque-signature",
            },
          ],
        },
        {
          role: "user",
          parts: [
            {
              functionResponse: {
                name: "weather",
                id: "call-1",
                response: { result: '{"forecast":"sunny"}' },
              },
            },
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens: 64,
        temperature: 0.2,
        topP: 0.8,
        candidateCount: 2,
        stopSequences: ["done"],
        responseMimeType: "application/json",
      },
      tools: [
        {
          functionDeclarations: [
            {
              name: "weather",
              parametersJsonSchema: { type: "object", properties: {} },
            },
          ],
        },
      ],
      toolConfig: { functionCallingConfig: { mode: "ANY" } },
    });
    expect(data).toEqual(original);
  });

  it("maps Bedrock Converse messages, images, tools and structured output", () => {
    const result = prepareNativeRequest(
      {
        ...base,
        temperature: 0.3,
        stop: "done",
        n: 1,
        messages: [
          { role: "system", content: "instructions" },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: "data:image/webp;base64,aA==" },
              },
            ],
          },
          {
            role: "assistant",
            content: "looking",
            tool_calls: [
              {
                type: "function",
                id: "call-2",
                function: { name: "weather", arguments: "{}" },
              },
            ],
          },
          { role: "tool", tool_call_id: "call-2", content: "sunny" },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "weather",
              description: "Forecast",
              parameters: schema,
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "weather" } },
        response_format: {
          type: "json_schema",
          json_schema: { name: "output", schema },
        },
      },
      "converse",
    );
    expect(result).toEqual({
      system: [{ text: "instructions" }],
      messages: [
        {
          role: "user",
          content: [{ image: { format: "webp", source: { bytes: "aA==" } } }],
        },
        {
          role: "assistant",
          content: [
            { text: "looking" },
            { toolUse: { toolUseId: "call-2", name: "weather", input: {} } },
          ],
        },
        {
          role: "user",
          content: [
            {
              toolResult: { toolUseId: "call-2", content: [{ text: "sunny" }] },
            },
          ],
        },
      ],
      inferenceConfig: {
        maxTokens: 32,
        temperature: 0.3,
        stopSequences: ["done"],
      },
      toolConfig: {
        tools: [
          {
            toolSpec: {
              name: "weather",
              description: "Forecast",
              inputSchema: { json: schema },
            },
          },
        ],
        toolChoice: { tool: { name: "weather" } },
      },
      outputConfig: {
        textFormat: {
          type: "json_schema",
          structure: {
            jsonSchema: { name: "output", schema: JSON.stringify(schema) },
          },
        },
      },
    });
  });

  it.each(protocols)(
    "supports a minimal %s request and an explicit text response format",
    (protocol) => {
      const result = prepareNativeRequest(
        {
          ...base,
          response_format: { type: "text" },
          parallel_tool_calls: true,
        },
        protocol,
      );
      expect(result).not.toHaveProperty("output_config");
      expect(result).not.toHaveProperty("outputConfig");
      expect(JSON.stringify(result)).toContain("hello");
    },
  );

  it.each(["generateContent", "converse"] as const)(
    "does not invent a token limit for %s",
    (protocol) => {
      const result = prepareNativeRequest(
        { model: "m", messages: [] },
        protocol,
      );
      expect(
        result[
          protocol === "generateContent"
            ? "generationConfig"
            : "inferenceConfig"
        ],
      ).toEqual({});
    },
  );

  it("maps Gemini JSON Schema and a forced function", () => {
    expect(
      prepareNativeRequest(
        {
          ...base,
          response_format: { type: "json_schema", json_schema: { schema } },
          tool_choice: { type: "function", function: { name: "weather" } },
        },
        "generateContent",
      ),
    ).toMatchObject({
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: schema,
      },
      toolConfig: {
        functionCallingConfig: {
          mode: "ANY",
          allowedFunctionNames: ["weather"],
        },
      },
    });
  });

  it.each(["auto", "required", "none"])(
    "maps tool_choice=%s for Messages and Gemini",
    (choice) => {
      expect(
        prepareNativeRequest({ ...base, tool_choice: choice }, "messages")
          .tool_choice,
      ).toEqual({ type: choice === "required" ? "any" : choice });
      expect(
        prepareNativeRequest(
          { ...base, tool_choice: choice },
          "generateContent",
        ).toolConfig,
      ).toEqual({
        functionCallingConfig: {
          mode:
            choice === "auto" ? "AUTO" : choice === "required" ? "ANY" : "NONE",
        },
      });
    },
  );

  it.each(["auto", "required"])("maps Converse tool_choice=%s", (choice) => {
    expect(
      prepareNativeRequest({ ...base, tool_choice: choice }, "converse")
        .toolConfig,
    ).toEqual({ toolChoice: { [choice === "required" ? "any" : "auto"]: {} } });
  });

  it("disables parallel Messages tools with an automatic default choice", () => {
    expect(
      prepareNativeRequest(
        { ...base, parallel_tool_calls: false, stop: ["stop"] },
        "messages",
      ),
    ).toMatchObject({
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
      stop_sequences: ["stop"],
    });
  });

  it.each([
    { unexpected: true },
    { messages: null },
    { messages: [null] },
    { messages: [{ role: "user", content: [{ type: "text", text: 1 }] }] },
    { messages: [{ role: "user", content: [{ type: "audio" }] }] },
    { messages: [{ role: "user", content: 1 }] },
    {
      messages: [
        { role: "user", content: [{ type: "image_url", image_url: 1 }] },
      ],
    },
    {
      messages: [
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: 2 } }],
        },
      ],
    },
    {
      messages: [
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: "data:invalid" } }],
        },
      ],
    },
    { messages: [{ role: "invalid", content: "text" }] },
    { messages: [{ role: "assistant", function_call: {} }] },
    { messages: [{ role: "assistant", tool_calls: [{ type: "custom" }] }] },
    {
      messages: [
        { role: "assistant", tool_calls: [{ type: "function", id: 2 }] },
      ],
    },
    {
      messages: [
        {
          role: "assistant",
          tool_calls: [{ type: "function", id: "a", function: { name: 1 } }],
        },
      ],
    },
    {
      messages: [
        {
          role: "assistant",
          tool_calls: [
            {
              type: "function",
              id: "a",
              function: { name: "f", arguments: "bad" },
            },
          ],
        },
      ],
    },
    {
      messages: [
        {
          role: "assistant",
          tool_calls: [
            {
              type: "function",
              id: "a",
              function: { name: "f", arguments: "[]" },
            },
          ],
        },
      ],
    },
    { messages: [{ role: "tool", tool_call_id: 1 }] },
    { tools: [{ type: "custom" }] },
    { tools: [{ type: "function", function: { name: 1 } }] },
    { tool_choice: "invalid" },
    { tool_choice: { function: { name: 2 } } },
    { response_format: { type: "invalid" } },
  ])("rejects an unmappable request: %j", (changes) => {
    for (const protocol of protocols)
      expect(() =>
        prepareNativeRequest({ ...base, ...changes }, protocol),
      ).toThrow(BadRequestError);
  });

  it.each(["messages", "converse"] as const)(
    "rejects unsupported choice counts and unstructured JSON for %s",
    (protocol) => {
      expect(() => prepareNativeRequest({ ...base, n: 2 }, protocol)).toThrow(
        "n other than 1",
      );
      expect(() =>
        prepareNativeRequest(
          { ...base, response_format: { type: "json_object" } },
          protocol,
        ),
      ).toThrow("without json_schema");
    },
  );

  it.each(["generateContent", "converse"] as const)(
    "rejects remote images and a forced sequential tool policy for %s",
    (protocol) => {
      expect(() =>
        prepareNativeRequest(
          {
            ...base,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "image_url",
                    image_url: { url: "https://example.test/photo" },
                  },
                ],
              },
            ],
          },
          protocol,
        ),
      ).toThrow("non-base64 images");
      expect(() =>
        prepareNativeRequest({ ...base, parallel_tool_calls: false }, protocol),
      ).toThrow("parallel_tool_calls=false");
    },
  );

  it("rejects missing Messages output limits, orphan Gemini tool results, and Converse tool_choice=none", () => {
    expect(() =>
      prepareNativeRequest({ model: "m", messages: [] }, "messages"),
    ).toThrow("without max_tokens");
    expect(() =>
      prepareNativeRequest(
        {
          ...base,
          messages: [
            { role: "tool", tool_call_id: "unknown", content: "result" },
          ],
        },
        "generateContent",
      ),
    ).toThrow("without a preceding call");
    expect(() =>
      prepareNativeRequest({ ...base, tool_choice: "none" }, "converse"),
    ).toThrow("tool_choice=none");
  });

  it.each([
    undefined,
    {},
    { google: {} },
    { google: { thought_signature: 1 } },
  ])("does not invent a Gemini thought signature for %j", (extra_content) => {
    const converted = prepareNativeRequest(
      {
        ...base,
        messages: [
          {
            role: "assistant",
            tool_calls: [
              {
                type: "function",
                id: "call-1",
                function: { name: "f", arguments: "{}" },
                extra_content,
              },
            ],
          },
        ],
      },
      "generateContent",
    );
    expect(converted.contents).toEqual([
      {
        role: "model",
        parts: [{ functionCall: { id: "call-1", name: "f", args: {} } }],
      },
    ]);
  });
});
