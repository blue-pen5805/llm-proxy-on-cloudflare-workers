import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cline } from "~/src/providers/cline/provider";
import { Secrets } from "~/src/utils/secrets";

describe("Cline provider", () => {
  beforeEach(() => {
    vi.spyOn(Secrets, "getAll").mockImplementation((name) =>
      name === "CLINE_API_KEY" ? ["cline-token"] : [],
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("declares its API endpoints and credential", () => {
    const provider = new Cline();

    expect(provider.apiKeyName).toBe("CLINE_API_KEY");
    expect(provider.baseUrl()).toBe("https://api.cline.bot/api/v1");
    expect(provider.chatCompletionPath).toBe("/chat/completions");
    expect(provider.modelsPath).toBe("/ai/cline/recommended-models");
    expect(provider.available()).toBe(true);
  });

  it("is unavailable without a configured token", () => {
    vi.mocked(Secrets.getAll).mockReturnValue([]);
    expect(new Cline().available()).toBe(false);
  });

  it("builds authenticated chat and recommended-model requests", async () => {
    const provider = new Cline();
    const [chatPath, chatInit] = await provider.buildChatCompletionsRequest({
      body: JSON.stringify({
        model: "anthropic/claude-sonnet",
        messages: [{ role: "user", content: "hello" }],
        temperature: 0.2,
        unsupported: "removed",
      }),
      headers: { "X-Request": "kept" },
    });
    const [chatUrl, builtChatInit] = await provider.buildRequest(
      chatPath,
      chatInit,
    );

    expect(chatUrl).toBe("https://api.cline.bot/api/v1/chat/completions");
    expect(JSON.parse(String(builtChatInit.body))).toEqual({
      model: "anthropic/claude-sonnet",
      messages: [{ role: "user", content: "hello" }],
      temperature: 0.2,
    });
    expect(new Headers(builtChatInit.headers)).toEqual(
      new Headers({
        Authorization: "Bearer cline-token",
        "Content-Type": "application/json",
        "X-Request": "kept",
      }),
    );

    const [modelsPath, modelsInit] = await provider.buildModelsRequest();
    const [modelsUrl, builtModelsInit] = await provider.buildRequest(
      modelsPath,
      modelsInit,
    );
    expect(modelsUrl).toBe(
      "https://api.cline.bot/api/v1/ai/cline/recommended-models",
    );
    expect(builtModelsInit.method).toBe("GET");
    expect(new Headers(builtModelsInit.headers)).toEqual(
      new Headers({
        Authorization: "Bearer cline-token",
        "Content-Type": "application/json",
      }),
    );
  });

  it("unwraps successful non-streaming Chat Completions responses", async () => {
    const completion = {
      id: "gen-test",
      object: "chat.completion",
      created: 1784397432,
      model: "deepseek/deepseek-v4-flash",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: "hello",
            reasoning: "reasoning text",
            reasoning_details: [
              {
                type: "reasoning.text",
                text: "reasoning text",
                format: "unknown",
                index: 0,
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
    };
    const upstream = new Response(
      JSON.stringify({ data: completion, success: true }),
      {
        status: 200,
        statusText: "Upstream OK",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": "999",
          "Content-Encoding": "gzip",
          ETag: '"wrapped"',
          "X-Cline-Generation-Id": "gen-test",
        },
      },
    );

    const response = await new Cline().transformChatCompletionsResponse(
      upstream,
    );

    expect(response).not.toBe(upstream);
    expect(response.status).toBe(200);
    expect(response.statusText).toBe("Upstream OK");
    await expect(response.json()).resolves.toEqual(completion);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("X-Cline-Generation-Id")).toBe("gen-test");
    expect(response.headers.has("Content-Length")).toBe(false);
    expect(response.headers.has("Content-Encoding")).toBe(false);
    expect(response.headers.has("ETag")).toBe(false);
  });

  it("preserves streaming SSE responses without reading or rewriting them", async () => {
    const sse = [
      'data: {"id":"gen-test","object":"chat.completion.chunk","choices":[{"delta":{"role":"assistant"}}]}',
      'data: {"id":"gen-test","object":"chat.completion.chunk","choices":[{"delta":{"reasoning":"hello"}}]}',
      "data: [DONE]",
      "",
    ].join("\n\n");
    const upstream = new Response(sse, {
      headers: { "Content-Type": "text/event-stream" },
    });

    const response = await new Cline().transformChatCompletionsResponse(
      upstream,
    );

    expect(response).toBe(upstream);
    expect(await response.text()).toBe(sse);
  });

  it.each([
    [
      "an error response",
      new Response(
        JSON.stringify({ data: { error: "denied" }, success: true }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      ),
    ],
    [
      "an unknown JSON response",
      new Response(JSON.stringify({ data: { id: "model" }, success: false }), {
        headers: { "Content-Type": "application/json" },
      }),
    ],
    [
      "malformed JSON",
      new Response("not-json", {
        headers: { "Content-Type": "application/json" },
      }),
    ],
  ])("preserves %s", async (_description, upstream) => {
    const response = await new Cline().transformChatCompletionsResponse(
      upstream,
    );
    expect(response).toBe(upstream);
  });

  it("converts every recommended-model group and retains its metadata", () => {
    expect(
      new Cline().convertModelsToOpenAIFormat({
        recommended: [
          {
            id: "anthropic/claude-sonnet",
            name: "Claude Sonnet",
            description: "Recommended model",
            tags: ["NEW"],
          },
        ],
        free: [
          {
            id: "vendor/free-model:free",
            name: "Free model",
            description: "Free model description",
            tags: [],
          },
        ],
        clinePass: [
          {
            id: "cline-pass/pass-model",
            name: "Pass model",
            description: "Subscription model",
            tags: ["PASS"],
          },
        ],
      }),
    ).toEqual({
      object: "list",
      data: [
        {
          id: "anthropic/claude-sonnet",
          object: "model",
          created: 0,
          owned_by: "cline",
          _: {
            name: "Claude Sonnet",
            description: "Recommended model",
            tags: ["NEW"],
            category: "recommended",
          },
        },
        {
          id: "vendor/free-model:free",
          object: "model",
          created: 0,
          owned_by: "cline",
          _: {
            name: "Free model",
            description: "Free model description",
            tags: [],
            category: "free",
          },
        },
        {
          id: "cline-pass/pass-model",
          object: "model",
          created: 0,
          owned_by: "cline",
          _: {
            name: "Pass model",
            description: "Subscription model",
            tags: ["PASS"],
            category: "clinePass",
          },
        },
      ],
    });
  });
});
