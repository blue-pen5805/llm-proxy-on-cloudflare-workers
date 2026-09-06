import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudflareAIGateway } from "~/src/ai_gateway";
import {
  jsonEndpoint,
  chatCompletionsEndpoint,
} from "~/src/providers/inference";
import { createProvider } from "~/src/providers/provider";
import { handleChatCompletionsRequest } from "~/src/requests/chat_completions";
import { handleMessagesRequest } from "~/src/requests/messages";
import { convertMessagesRequest } from "~/src/requests/messages/request";
import { handleResponsesRequest } from "~/src/requests/responses";
import { convertResponsesRequest } from "~/src/requests/responses/request";
import { Config } from "~/src/utils/config";
import { Environments } from "~/src/utils/environments";
import { createTestRoutedContext } from "../../helpers/request_context";

const gateway = (strict = false) =>
  new CloudflareAIGateway(
    "account",
    "gateway",
    "example-gateway-token",
    undefined,
    strict,
  );
const responseBody = {
  id: "resp_native",
  object: "response",
  output: [],
  native_field: { preserved: true },
};
const chatBody = {
  id: "chat_1",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "hello" },
      finish_reason: "stop",
    },
  ],
};
const messageBody = {
  id: "msg_native",
  type: "message",
  content: [
    { type: "thinking", thinking: "native reasoning", signature: "signature" },
  ],
  stop_reason: "end_turn",
};

function context(
  model: string,
  body: Record<string, unknown> = {},
  headers: HeadersInit = {},
) {
  return createTestRoutedContext({
    request: new Request("https://proxy.test/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer example-proxy-key",
        cookie: "private=cookie",
        "cf-aig-skip-cache": "true",
        ...headers,
      },
      body: JSON.stringify({ model, input: "hello", ...body }),
    }),
  });
}
function sentBody(fetch: ReturnType<typeof vi.spyOn>, index = 0) {
  return JSON.parse(String(fetch.mock.calls[index]![1].body));
}

describe("public protocol native routing", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses provider Chat conversion defaults when the requested API is absent", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => Response.json(chatBody));
    await Environments.runWithConfig(
      {
        AWS_BEDROCK_REGION: "us-east-1",
        AWS_BEARER_TOKEN_BEDROCK: "example-key",
        CLOUDFLARE_ACCOUNT_ID: "account",
        CLOUDFLARE_API_KEY: "example-key",
        PERPLEXITYAI_API_KEY: "example-key",
      },
      async () => {
        const responses = await handleMessagesRequest(
          context("aws-bedrock/openai.gpt-oss-20b-1:0", {
            input: undefined,
            messages: [{ role: "user", content: "hello" }],
            max_tokens: 64,
          }),
          gateway(),
        );
        expect(((await responses.json()) as any).type).toBe("message");
        const messages = await handleMessagesRequest(
          context("workers-ai/@cf/openai/gpt-oss-120b", {
            input: undefined,
            messages: [{ role: "user", content: "hello" }],
            max_tokens: 64,
          }),
          gateway(),
        );
        expect(((await messages.json()) as any).type).toBe("message");
        const perplexity = await handleResponsesRequest(
          context("perplexity-ai/model"),
          gateway(),
        );
        expect(((await perplexity.json()) as any).object).toBe("response");
      },
    );
    expect(String(fetch.mock.calls[0]![0])).toContain(
      "/aws-bedrock/bedrock-runtime/us-east-1/openai/v1/chat/completions",
    );
    expect(String(fetch.mock.calls[1]![0])).toBe(
      "https://api.cloudflare.com/client/v4/accounts/account/ai/v1/chat/completions",
    );
    expect(String(fetch.mock.calls[2]![0])).toContain(
      "/perplexity-ai/chat/completions",
    );
    expect(sentBody(fetch, 2)).toMatchObject({
      model: "model",
      messages: [{ role: "user", content: "hello" }],
    });
    expect(sentBody(fetch).messages).toEqual([
      { role: "user", content: "hello" },
    ]);
    expect(sentBody(fetch, 1).messages).toEqual([
      { role: "user", content: "hello" },
    ]);
  });

  it("retains standalone converter validation for invalid Messages envelopes", () => {
    for (const body of [
      null,
      {},
      { model: "model" },
      { model: "model", messages: [] },
    ]) {
      expect(() => convertMessagesRequest(body)).toThrow("Invalid request.");
    }
  });

  it("drops malformed optional cache breakpoints only on conversion", () => {
    for (const prompt_cache_breakpoint of ["invalid", {}, { mode: "other" }]) {
      const converted = convertResponsesRequest({
        model: "model",
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: "hello", prompt_cache_breakpoint },
            ],
          },
        ],
      });
      expect(converted.chat.messages).toEqual([
        { role: "user", content: [{ type: "text", text: "hello" }] },
      ]);
    }
  });

  it("prefers Google Chat for Chat callers and uses GenerateContent for Responses conversion", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json(chatBody))
      .mockResolvedValueOnce(
        Response.json({
          candidates: [
            { content: { parts: [{ text: "hello" }] }, finishReason: "STOP" },
          ],
        }),
      );
    await Environments.runWithConfig(
      { GEMINI_API_KEY: "example-gemini-key" },
      async () => {
        const chat = await handleChatCompletionsRequest(
          context("google-ai-studio/gemini", {
            input: undefined,
            messages: [{ role: "user", content: "hello" }],
            extra_body: {
              google: { thinking_config: { include_thoughts: true } },
            },
          }),
          gateway(),
        );
        expect(((await chat.json()) as any).choices[0].message.content).toBe(
          "hello",
        );
        const responses = await handleResponsesRequest(
          context("google-ai-studio/gemini"),
          gateway(),
        );
        expect(((await responses.json()) as any).object).toBe("response");
      },
    );
    expect(String(fetch.mock.calls[0]![0])).toContain(
      "/v1beta/openai/chat/completions",
    );
    expect(sentBody(fetch).extra_body).toEqual({
      google: { thinking_config: { include_thoughts: true } },
    });
    expect(
      new Headers(fetch.mock.calls[0]![1]!.headers).get("authorization"),
    ).toBe("Bearer example-gemini-key");
    expect(String(fetch.mock.calls[1]![0])).toContain(
      "/v1beta/models/gemini:generateContent",
    );
    expect(
      new Headers(fetch.mock.calls[1]![1]!.headers).get("x-goog-api-key"),
    ).toBe("example-gemini-key");
    expect(sentBody(fetch, 1).contents).toEqual([
      { role: "user", parts: [{ text: "hello" }] },
    ]);
  });

  it.each([false, true])(
    "uses Anthropic's matching Chat API for JSON and SSE (Gateway=%s)",
    async (useGateway) => {
      const fetch = vi.spyOn(globalThis, "fetch");
      await Environments.runWithConfig(
        { ANTHROPIC_API_KEY: { paid: ["example-key-0", "example-key-1"] } },
        async () => {
          for (const stream of [false, true]) {
            const output = stream
              ? 'data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n'
              : JSON.stringify(chatBody);
            const upstream = new Response(output, {
              headers: {
                "content-type": stream
                  ? "text/event-stream"
                  : "application/json",
              },
            });
            fetch.mockResolvedValueOnce(upstream);
            const state = context("anthropic:paid/claude", {
              input: undefined,
              messages: [{ role: "developer", content: "hello" }],
              thinking: { type: "adaptive" },
              stream,
            });
            state.apiKeyIndex = 1;
            expect(
              await handleChatCompletionsRequest(
                state,
                useGateway ? gateway() : undefined,
              ),
            ).toBe(upstream);
            expect(await upstream.text()).toBe(output);
            const [url, init] = fetch.mock.lastCall!;
            expect(String(url)).toBe(
              useGateway
                ? "https://gateway.ai.cloudflare.com/v1/account/gateway/anthropic/v1/chat/completions"
                : "https://api.anthropic.com/v1/chat/completions",
            );
            expect(JSON.parse(String(init!.body))).toEqual({
              model: "claude",
              messages: [{ role: "developer", content: "hello" }],
              thinking: { type: "adaptive" },
              stream,
            });
            const headers = new Headers(init!.headers);
            expect(headers.get("authorization")).toBe("Bearer example-key-1");
            expect(headers.has("x-api-key")).toBe(false);
            expect(headers.has("cookie")).toBe(false);
          }
        },
      );
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );

  it("retains the default Workers AI Chat transport path", () => {
    const [url] = gateway().buildWorkersAiInferenceRequest({
      headers: { authorization: "Bearer example-key" },
    });
    expect(url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/account/ai/v1/chat/completions",
    );
  });

  it.each([false, true])(
    "preserves Responses fields and upstream response (Gateway=%s)",
    async (useGateway) => {
      const upstream = Response.json(responseBody);
      const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(upstream);
      vi.spyOn(Config, "chatResponseMetadataEnabled").mockReturnValue(true);
      const fields = {
        input: [{ type: "reasoning", encrypted_content: "encrypted-state" }],
        previous_response_id: "resp_previous",
        background: true,
        truncation: "auto",
        tools: [{ type: "web_search" }],
        include: ["reasoning.encrypted_content"],
        reasoning: { effort: "high", summary: "auto" },
        future_native_option: { keep: true },
      };
      await Environments.runWithConfig(
        { OPENAI_API_KEY: "example-upstream-key" },
        async () => {
          const response = await handleResponsesRequest(
            context("openai/gpt-5", fields),
            useGateway ? gateway() : undefined,
          );
          expect(response).toBe(upstream);
          expect(await response.json()).toEqual(responseBody);
        },
      );
      expect(String(fetch.mock.calls[0]![0])).toBe(
        useGateway
          ? "https://gateway.ai.cloudflare.com/v1/account/gateway/openai/responses"
          : "https://api.openai.com/v1/responses",
      );
      expect(sentBody(fetch)).toEqual({ model: "gpt-5", ...fields });
      const headers = new Headers(fetch.mock.calls[0]![1]!.headers);
      expect(headers.get("authorization")).toBe("Bearer example-upstream-key");
      expect(headers.has("cookie")).toBe(false);
      expect(headers.has("cf-aig-skip-cache")).toBe(useGateway);
      if (useGateway)
        expect(JSON.parse(headers.get("cf-aig-metadata")!)).toMatchObject({
          llm_proxy_endpoint: "responses",
        });
      expect(fetch.mock.calls[0]![1]!.redirect).toBe("manual");
    },
  );

  it.each([false, true])(
    "preserves native Messages, thinking and cache controls (Gateway=%s)",
    async (useGateway) => {
      const upstream = Response.json(messageBody);
      const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(upstream);
      const body = {
        input: undefined,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "hello",
                cache_control: { type: "ephemeral" },
              },
            ],
          },
        ],
        max_tokens: 4096,
        thinking: { type: "enabled", budget_tokens: 1024 },
        tools: [{ type: "web_search_20250305", name: "web_search" }],
      };
      await Environments.runWithConfig(
        { ANTHROPIC_API_KEY: "example-anthropic-key" },
        async () => {
          expect(
            await handleMessagesRequest(
              context("anthropic/claude", body, {
                "anthropic-beta": "example-beta",
              }),
              useGateway ? gateway() : undefined,
            ),
          ).toBe(upstream);
        },
      );
      expect(String(fetch.mock.calls[0]![0])).toBe(
        useGateway
          ? "https://gateway.ai.cloudflare.com/v1/account/gateway/anthropic/v1/messages"
          : "https://api.anthropic.com/v1/messages",
      );
      expect(sentBody(fetch)).toEqual({
        model: "claude",
        ...JSON.parse(JSON.stringify(body)),
      });
      const headers = new Headers(fetch.mock.calls[0]![1]!.headers);
      expect(headers.get("x-api-key")).toBe("example-anthropic-key");
      expect(headers.get("anthropic-beta")).toBe("example-beta");
      expect(headers.has("authorization")).toBe(false);
    },
  );

  it.each([
    [
      "groq/model",
      "GROQ_API_KEY",
      "https://api.groq.com/openai/v1/responses",
      "/groq/responses",
    ],
    [
      "grok/model",
      "GROK_API_KEY",
      "https://api.x.ai/v1/responses",
      "/grok/v1/responses",
    ],
    [
      "openrouter/author/model",
      "OPENROUTER_API_KEY",
      "https://openrouter.ai/api/v1/responses",
      "/openrouter/v1/responses",
    ],
    [
      "ollama/model",
      "OLLAMA_API_KEY",
      "https://ollama.com/v1/responses",
      "/custom-llm-proxy-ollama/v1/responses",
    ],
  ])(
    "declares Responses routing for %s",
    async (model, key, directUrl, gatewayPath) => {
      const fetch = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async () => Response.json(responseBody));
      await Environments.runWithConfig({ [key]: "example-key" }, async () => {
        for (const aiGateway of [undefined, gateway(true)]) {
          const response = await handleResponsesRequest(
            context(model),
            aiGateway,
          );
          expect(await response.json()).toEqual(responseBody);
        }
      });
      expect(String(fetch.mock.calls[0]![0])).toBe(directUrl);
      expect(String(fetch.mock.calls[1]![0])).toBe(
        `https://gateway.ai.cloudflare.com/v1/account/gateway${gatewayPath}`,
      );
      expect(sentBody(fetch)).toEqual({
        model: model.slice(model.indexOf("/") + 1),
        input: "hello",
      });
    },
  );

  it("passes OpenRouter Messages to its Messages endpoint", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json(messageBody));
    await Environments.runWithConfig(
      { OPENROUTER_API_KEY: "example-key" },
      async () => {
        expect(
          await (
            await handleMessagesRequest(
              context("openrouter/anthropic/claude", {
                input: undefined,
                messages: [],
                max_tokens: 64,
              }),
              gateway(),
            )
          ).json(),
        ).toEqual(messageBody);
      },
    );
    expect(String(fetch.mock.calls[0]![0])).toContain(
      "/openrouter/v1/messages",
    );
  });

  it.each(["responses", "messages"] as const)(
    "keeps %s SSE bytes and propagates cancellation",
    async (protocol) => {
      const cancel = vi.fn();
      const bytes = new TextEncoder().encode(
        `event: native_extension\ndata: {"custom":true}\n\n`,
      );
      const upstream = new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes);
          },
          cancel,
        }),
        {
          headers: { "content-type": "text/event-stream", "x-native": "kept" },
        },
      );
      vi.spyOn(globalThis, "fetch").mockResolvedValue(upstream);
      await Environments.runWithConfig(
        { OPENAI_API_KEY: "example-key", ANTHROPIC_API_KEY: "example-key" },
        async () => {
          const response =
            protocol === "responses"
              ? await handleResponsesRequest(
                  context("openai/model", { stream: true }),
                  gateway(),
                )
              : await handleMessagesRequest(
                  context("anthropic/model", {
                    input: undefined,
                    stream: true,
                    messages: [],
                    max_tokens: 64,
                  }),
                  gateway(),
                );
          expect(response).toBe(upstream);
          const reader = response.body!.getReader();
          expect((await reader.read()).value).toEqual(bytes);
          await reader.cancel("client disconnected");
          expect(cancel).toHaveBeenCalledWith("client disconnected");
        },
      );
    },
  );

  it("keeps native error bodies instead of retrying a different protocol", async () => {
    const upstream = Response.json(
      {
        error: { message: "unsupported Responses model", native_code: "model" },
      },
      { status: 400 },
    );
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(upstream);
    await Environments.runWithConfig(
      { OPENAI_API_KEY: ["example-key-0", "example-key-1"] },
      async () => {
        expect(
          await handleResponsesRequest(context("openai/model"), gateway()),
        ).toBe(upstream);
      },
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rotates named-profile credentials for native Responses and respects an explicit key", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("busy", { status: 429 }))
      .mockResolvedValueOnce(Response.json(responseBody))
      .mockResolvedValueOnce(new Response("busy", { status: 429 }));
    await Environments.runWithConfig(
      {
        OPENAI_API_KEY: {
          default: ["example-default"],
          paid: ["example-paid-0", "example-paid-1"],
        },
      },
      async () => {
        const state = context("openai:paid/model");
        vi.spyOn(
          state.providers.get("openai:paid")!,
          "getNextApiKeyIndex",
        ).mockResolvedValue(0);
        expect((await handleResponsesRequest(state, gateway())).status).toBe(
          200,
        );
        const explicit = context("openai:paid/model");
        explicit.apiKeyIndex = 0;
        expect((await handleResponsesRequest(explicit, gateway())).status).toBe(
          429,
        );
      },
    );
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(
      new Headers(fetch.mock.calls[0]![1]!.headers).get("authorization"),
    ).toBe("Bearer example-paid-0");
    expect(
      new Headers(fetch.mock.calls[1]![1]!.headers).get("authorization"),
    ).toBe("Bearer example-paid-1");
    expect(
      JSON.parse(
        new Headers(fetch.mock.calls[1]![1]!.headers).get("cf-aig-metadata")!,
      ),
    ).toMatchObject({ llm_proxy_credentials: "paid:1" });
  });

  it.each([false, true])(
    "resolves mixed virtual models per candidate (native first=%s)",
    async (nativeFirst) => {
      const fetch = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response("busy", { status: 429 }))
        .mockResolvedValueOnce(
          Response.json(nativeFirst ? chatBody : responseBody),
        );
      vi.spyOn(Config, "defaultModel").mockReturnValue("virtual/outer");
      vi.spyOn(Config, "virtualModels").mockReturnValue({
        "virtual/outer": [{ model: "virtual/inner", retries: 0 }],
        "virtual/inner": (nativeFirst
          ? ["openai/model", "cerebras/model"]
          : ["cerebras/model", "openai/model"]
        ).map((model) => ({ model, retries: 0 })),
      });
      await Environments.runWithConfig(
        { OPENAI_API_KEY: "example-key", CEREBRAS_API_KEY: "example-key" },
        async () => {
          const state = context("default", { max_output_tokens: 64 });
          state.apiKeyIndex = 0;
          const response = await handleResponsesRequest(state, gateway());
          const body = (await response.json()) as Record<string, unknown>;
          expect(body.object).toBe("response");
          if (!nativeFirst) expect(body).toEqual(responseBody);
        },
      );
      const nativeIndex = nativeFirst ? 0 : 1;
      expect(String(fetch.mock.calls[nativeIndex]![0])).toContain(
        "/openai/responses",
      );
      expect(sentBody(fetch, nativeIndex)).toEqual({
        model: "model",
        input: "hello",
        max_output_tokens: 64,
      });
      expect(String(fetch.mock.calls[1 - nativeIndex]![0])).toContain(
        "/cerebras/chat/completions",
      );
      expect(sentBody(fetch, 1 - nativeIndex)).toMatchObject({
        model: "model",
        messages: [{ role: "user", content: "hello" }],
      });
    },
  );

  it("falls back to conversion for a model whose native capability is explicitly disabled", async () => {
    const provider = createProvider({
      openAICompatible: true,
      baseUrl: "https://example.test",
      endpoints: {
        responses: jsonEndpoint("/responses"),
        chat_completions: chatCompletionsEndpoint(),
      },
      resolveEndpoint(model) {
        return model === "legacy" ? null : undefined;
      },
    });
    expect(provider.resolveInference("current", "responses")).toBeDefined();
    expect(provider.resolveInference("legacy", "responses")?.native).toBe(
      false,
    );
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json(chatBody));
    const state = context("openai/legacy");
    vi.spyOn(state.providers, "get").mockReturnValue(provider);
    expect(
      ((await (await handleResponsesRequest(state, gateway())).json()) as any)
        .object,
    ).toBe("response");
    expect(String(fetch.mock.calls[0]![0])).toContain(
      "/openai/chat/completions",
    );
  });

  it("rejects unsupported conversion before fetching and strips Messages-only headers on fallback", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json(chatBody));
    await Environments.runWithConfig(
      { CEREBRAS_API_KEY: "example-key", OPENAI_API_KEY: "example-key" },
      async () => {
        const invalid = await handleResponsesRequest(
          context("cerebras/model", { reasoning: "invalid" }),
          gateway(),
        );
        expect(invalid.status).toBe(400);
        expect(fetch).not.toHaveBeenCalled();
        const response = await handleMessagesRequest(
          context(
            "openai/model",
            { input: undefined, messages: [], max_tokens: 64 },
            {
              "anthropic-beta": "private-beta",
              "anthropic-version": "2023-06-01",
            },
          ),
          gateway(),
        );
        expect(((await response.json()) as any).type).toBe("message");
      },
    );
    const headers = new Headers(fetch.mock.calls[0]![1]!.headers);
    expect(headers.has("anthropic-beta")).toBe(false);
    expect(headers.has("anthropic-version")).toBe(false);
  });

  it("uses Workers AI Responses with the selected provider key and Gateway", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json(responseBody));
    await Environments.runWithConfig(
      {
        CLOUDFLARE_ACCOUNT_ID: "account",
        CLOUDFLARE_API_KEY: "example-workers-key",
      },
      async () => {
        expect(
          (
            await handleResponsesRequest(
              context("workers-ai/@cf/openai/gpt-oss-120b"),
              gateway(),
            )
          ).status,
        ).toBe(200);
        await expect(
          handleResponsesRequest(context("workers-ai/openai/model"), gateway()),
        ).rejects.toThrow("non-Workers-AI");
      },
    );
    expect(String(fetch.mock.calls[0]![0])).toBe(
      "https://api.cloudflare.com/client/v4/accounts/account/ai/v1/responses",
    );
    const headers = new Headers(fetch.mock.calls[0]![1]!.headers);
    expect(headers.get("authorization")).toBe("Bearer example-workers-key");
    expect(headers.get("cf-aig-gateway-id")).toBe("gateway");
    expect(headers.has("cf-aig-authorization")).toBe(false);
  });

  it("requires a Gateway context for Workers AI Responses before sending", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    await Environments.runWithConfig(
      { CLOUDFLARE_ACCOUNT_ID: "account", CLOUDFLARE_API_KEY: "example-key" },
      async () => {
        const response = await handleResponsesRequest(
          context("workers-ai/@cf/openai/gpt-oss-120b"),
        );
        expect(response.status).toBe(503);
        expect(await response.text()).toContain(
          "requires Cloudflare AI Gateway",
        );
      },
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "uses native Vertex Anthropic envelopes (stream=%s)",
    async (stream) => {
      const fetch = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(Response.json(messageBody));
      await Environments.runWithConfig(
        {
          CF_AIG_TOKEN: "example-token",
          GOOGLE_VERTEX_AI_SERVICE_ACCOUNT_JSON: {
            type: "service_account",
            project_id: "example-project",
            region: "us-central1",
            client_email: "example@example.test",
            private_key: "example-not-a-real-key",
          },
        },
        async () => {
          const state = context("google-vertex-ai/anthropic/claude", {
            input: undefined,
            messages: [],
            max_tokens: 64,
            stream,
            thinking: { type: "adaptive" },
          });
          const provider = state.providers.get("google-vertex-ai")!;
          const operation = provider.resolveInference(
            "anthropic/claude",
            "messages",
          )!.endpoint;
          const [path] = await operation.buildRequest.call(provider, {
            data: { model: "anthropic/claude", messages: [], max_tokens: 64 },
            headers: {},
            target: "gateway",
          });
          expect(path).toContain("/example-project/locations/us-central1/");
          expect((await handleMessagesRequest(state, gateway())).status).toBe(
            200,
          );
          expect(
            state.providers
              .get("google-vertex-ai")!
              .resolveInference("google/gemini", "messages")?.native,
          ).toBe(false);
          expect(
            state.providers
              .get("google-vertex-ai")!
              .resolveInference("anthropic/claude", "responses")?.native,
          ).toBe(false);
        },
      );
      expect(String(fetch.mock.calls[0]![0])).toBe(
        `https://gateway.ai.cloudflare.com/v1/account/gateway/google-vertex-ai/v1/projects/example-project/locations/us-central1/publishers/anthropic/models/claude:${stream ? "streamRawPredict" : "rawPredict"}`,
      );
      expect(sentBody(fetch)).toEqual({
        messages: [],
        max_tokens: 64,
        stream,
        thinking: { type: "adaptive" },
        anthropic_version: "vertex-2023-10-16",
      });
    },
  );
});
