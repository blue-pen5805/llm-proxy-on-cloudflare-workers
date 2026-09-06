import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { CloudflareAIGateway } from "~/src/ai_gateway";
import { customProviderRoute } from "~/src/ai_gateway/custom_provider";
import { ProviderRegistry } from "~/src/providers";
import { OpenCodeGo, OpenCodeZen } from "~/src/providers/opencode";
import { handleChatCompletionsRequest } from "~/src/requests/chat_completions";
import { handleMessagesRequest } from "~/src/requests/messages";
import { handleModelsRequest } from "~/src/requests/models";
import { handleProviderProxyRequest } from "~/src/requests/proxy";
import { handleResponsesRequest } from "~/src/requests/responses";
import { Environments } from "~/src/utils/environments";
import {
  opencodeCatalog,
  opencodeCatalogUrl,
  opencodeChatRequest,
  responsesOutput,
} from "../../helpers/opencode";
import { createTestRoutedContext } from "../../helpers/request_context";

const handlers = {
  chat_completions: handleChatCompletionsRequest,
  responses: handleResponsesRequest,
  messages: handleMessagesRequest,
};
const messagesOutput = {
  id: "msg_example",
  type: "message",
  role: "assistant",
  model: "messages",
  content: [{ type: "text", text: "hello back" }],
  stop_reason: "end_turn",
  usage: { input_tokens: 2, output_tokens: 3 },
};
const chatOutput = {
  id: "chat_example",
  object: "chat.completion",
  model: "chat",
  created: 123,
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "hello back" },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
};
function sse(...events: unknown[]) {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}
function output(model: string, stream: boolean) {
  if (!stream)
    return Response.json(
      model === "chat"
        ? chatOutput
        : model === "responses"
          ? responsesOutput
          : model === "messages"
            ? messagesOutput
            : {
                candidates: [
                  {
                    content: { parts: [{ text: "hello back" }] },
                    finishReason: "STOP",
                  },
                ],
                usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3 },
              },
    );
  const body =
    model === "chat"
      ? sse(
          {
            id: "chat_example",
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: "hello back" },
                finish_reason: null,
              },
            ],
          },
          {
            id: "chat_example",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: chatOutput.usage,
          },
        ) + "data: [DONE]\n\n"
      : model === "responses"
        ? sse(
            { type: "response.created", response: { id: "resp_example" } },
            { type: "response.output_text.delta", delta: "hello back" },
            { type: "response.completed", response: responsesOutput },
          )
        : model === "messages"
          ? sse(
              {
                type: "message_start",
                message: { usage: { input_tokens: 2 } },
              },
              {
                type: "content_block_delta",
                delta: { type: "text_delta", text: "hello back" },
              },
              {
                type: "message_delta",
                delta: { stop_reason: "end_turn" },
                usage: { output_tokens: 3 },
              },
              { type: "message_stop" },
            )
          : sse({
              candidates: [
                {
                  index: 0,
                  content: { parts: [{ text: "hello back" }] },
                  finishReason: "STOP",
                },
              ],
              usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3 },
            });
  return new Response(body, {
    headers: { "content-type": "text/event-stream" },
  });
}

describe("OpenCode public routing", () => {
  beforeEach(async () => {
    // These protocol fixtures exercise origin responses independently of cache state.
    const cache = await caches.open("llm-proxy-opencode-protocol-v1");
    vi.spyOn(cache, "match").mockResolvedValue(undefined);
    vi.spyOn(cache, "put").mockResolvedValue(undefined);
    vi.spyOn(caches, "open").mockResolvedValue(cache);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("bounds catalog resolution by the virtual-model timeout before selecting the next candidate", async () => {
    vi.useFakeTimers();
    await Environments.runWithConfig(
      {
        OPENCODE_API_KEY: "example-key",
        VIRTUAL_MODELS: {
          "virtual/opencode": [
            { model: "opencode-zen/chat", timeout: 10 },
            "opencode-go/chat",
          ],
        },
      },
      async () => {
        const fetch = vi
          .spyOn(globalThis, "fetch")
          .mockImplementationOnce(
            (_url, init) =>
              new Promise((_resolve, reject) => {
                init!.signal!.addEventListener(
                  "abort",
                  () => reject(init!.signal!.reason),
                  { once: true },
                );
              }),
          )
          .mockResolvedValueOnce(Response.json(opencodeCatalog()))
          .mockResolvedValueOnce(Response.json(chatOutput));
        const pending = handleChatCompletionsRequest(
          createTestRoutedContext({
            request: new Request("https://proxy.example/v1/chat/completions", {
              method: "POST",
              body: JSON.stringify({
                model: "virtual/opencode",
                ...opencodeChatRequest,
              }),
            }),
          }),
        );
        await vi.advanceTimersByTimeAsync(11);
        expect((await pending).status).toBe(200);
        expect(fetch).toHaveBeenCalledTimes(3);
        expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
        expect(fetch.mock.calls[1][0]).toBe(opencodeCatalogUrl);
        expect(fetch.mock.calls[2][0]).toBe(
          "https://opencode.ai/zen/go/v1/chat/completions",
        );
      },
    );
  });

  it.each(["opencode-zen", "opencode-go"])(
    "routes %s model SDKs through every public protocol and transport",
    async (providerName) => {
      const fetch = vi.spyOn(globalThis, "fetch");
      for (const mode of ["direct", "nonstrict", "strict"]) {
        await Environments.runWithConfig(
          {
            OPENCODE_API_KEY: { paid: ["example-key-0", "example-key-1"] },
            ALWAYS_USE_AI_GATEWAY: mode === "strict",
          },
          async () => {
            for (const protocol of [
              "chat_completions",
              "responses",
              "messages",
            ] as const) {
              for (const model of ["chat", "responses", "messages", "google"]) {
                for (const stream of [false, true]) {
                  fetch.mockClear();
                  const upstream = output(model, stream);
                  const native =
                    (model === "chat" && protocol === "chat_completions") ||
                    model === protocol;
                  const body = {
                    model: `${providerName}:paid/${model}`,
                    ...(protocol === "responses"
                      ? { input: "hello", max_output_tokens: 32 }
                      : opencodeChatRequest),
                    stream,
                    ...(native ? { provider_extension: "preserved" } : {}),
                    ...(protocol === "chat_completions"
                      ? { stream_options: { include_usage: true } }
                      : {}),
                  };
                  fetch
                    .mockResolvedValueOnce(Response.json(opencodeCatalog()))
                    .mockResolvedValueOnce(upstream);
                  const context = createTestRoutedContext({
                    request: new Request(
                      "https://proxy.example/v1/chat/completions",
                      {
                        method: "POST",
                        headers: {
                          authorization: "Bearer proxy-secret",
                          cookie: "private=yes",
                          "x-opencode-session": "example-session",
                          "user-agent": "example-agent/1.0",
                        },
                        body: JSON.stringify(body),
                      },
                    ),
                    apiKeyIndex: 1,
                  });
                  const response = await handlers[protocol](
                    context,
                    mode === "direct"
                      ? undefined
                      : new CloudflareAIGateway(
                          "account",
                          "gateway",
                          "example-gateway-token",
                          undefined,
                          mode === "strict",
                        ),
                  );
                  expect(response.status).toBe(200);
                  if (native) expect(response).toBe(upstream);
                  const text = await response.text();
                  expect(text).toContain("hello back");
                  if (stream && protocol === "chat_completions")
                    expect(text).toContain("[DONE]");
                  expect(fetch).toHaveBeenCalledTimes(2);
                  expect(fetch.mock.calls[0][0]).toBe(opencodeCatalogUrl);
                  const [url, init] = fetch.mock.lastCall!;
                  const path =
                    model === "google"
                      ? `/models/google:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`
                      : model === "chat"
                        ? "/chat/completions"
                        : `/${model}`;
                  const base =
                    providerName === "opencode-go"
                      ? "https://opencode.ai/zen/go/v1"
                      : "https://opencode.ai/zen/v1";
                  expect(url).toBe(
                    mode === "strict"
                      ? `https://gateway.ai.cloudflare.com/v1/account/gateway/${customProviderRoute(providerName)}/v1${path}`
                      : base + path,
                  );
                  const sent = JSON.parse(String(init?.body));
                  if (native) expect(sent).toEqual({ ...body, model });
                  else if (model === "google")
                    expect(sent.contents).toEqual([
                      { role: "user", parts: [{ text: "hello" }] },
                    ]);
                  else if (model === "responses")
                    expect(sent.input).toEqual([
                      {
                        role: "user",
                        content: [{ type: "input_text", text: "hello" }],
                      },
                    ]);
                  else
                    expect(sent.messages).toEqual([
                      {
                        role: "user",
                        content:
                          model === "messages"
                            ? [{ type: "text", text: "hello" }]
                            : "hello",
                      },
                    ]);
                  const headers = new Headers(init?.headers);
                  const authHeader =
                    model === "messages"
                      ? "x-api-key"
                      : model === "google"
                        ? "x-goog-api-key"
                        : "authorization";
                  expect(headers.get(authHeader)).toBe(
                    authHeader === "authorization"
                      ? "Bearer example-key-1"
                      : "example-key-1",
                  );
                  for (const other of [
                    "authorization",
                    "x-api-key",
                    "x-goog-api-key",
                  ].filter((name) => name !== authHeader))
                    expect(headers.has(other)).toBe(false);
                  if (model === "messages")
                    expect(headers.get("anthropic-version")).toBe("2023-06-01");
                  expect(headers.get("x-opencode-session")).toBe(
                    "example-session",
                  );
                  expect(headers.get("user-agent")).toBe("example-agent/1.0");
                  expect(headers.has("cookie")).toBe(false);
                  expect(init?.redirect).toBe("manual");
                }
              }
            }
          },
        );
      }
    },
  );

  it("passes upstream errors through without trying another protocol or credential", async () => {
    await Environments.runWithConfig(
      { OPENCODE_API_KEY: ["example-0", "example-1"] },
      async () => {
        const fetch = vi.spyOn(globalThis, "fetch");
        for (const model of ["chat", "responses", "messages", "google"]) {
          const upstream = Response.json(
            { error: "provider failure" },
            { status: 429 },
          );
          fetch
            .mockClear()
            .mockResolvedValueOnce(Response.json(opencodeCatalog()))
            .mockResolvedValueOnce(upstream);
          const response = await handleChatCompletionsRequest(
            createTestRoutedContext({
              request: new Request(
                "https://proxy.example/v1/chat/completions",
                {
                  method: "POST",
                  body: JSON.stringify({
                    model: `opencode-zen/${model}`,
                    ...opencodeChatRequest,
                  }),
                },
              ),
            }),
          );
          expect(response).toBe(upstream);
          expect(fetch).toHaveBeenCalledTimes(2);
        }
      },
    );
  });

  it.each([false, true])(
    "discovers both provider model lists independently (strict %s)",
    async (strict) => {
      await Environments.runWithConfig(
        {
          OPENCODE_API_KEY: "example-key",
          MODELS_CACHE_TTL_SECONDS: 0,
          ALWAYS_USE_AI_GATEWAY: strict,
        },
        async () => {
          const fetch = vi
            .spyOn(globalThis, "fetch")
            .mockImplementation(async (url) => {
              const go = String(url).includes(strict ? "opencode-go" : "/go/");
              return Response.json({
                object: "list",
                data: [
                  {
                    id: go ? "go-model" : "zen-model",
                    object: "model",
                    created: 123,
                    owned_by: "opencode",
                  },
                ],
              });
            });
          const response = await handleModelsRequest(
            createTestRoutedContext({
              providers: new ProviderRegistry({
                "opencode-zen": OpenCodeZen,
                "opencode-go": OpenCodeGo,
              }),
            }),
            strict
              ? new CloudflareAIGateway(
                  "account",
                  "gateway",
                  "example-gateway-token",
                  undefined,
                  true,
                )
              : undefined,
          );
          const body = (await response.json()) as { data: { id: string }[] };
          expect(body.data.map(({ id }) => id).sort()).toEqual([
            "opencode-go/go-model",
            "opencode-zen/zen-model",
          ]);
          expect(fetch).toHaveBeenCalledTimes(2);
          expect(fetch.mock.calls.map(([url]) => String(url)).sort()).toEqual(
            strict
              ? ["opencode-go", "opencode-zen"].map(
                  (name) =>
                    `https://gateway.ai.cloudflare.com/v1/account/gateway/${customProviderRoute(name)}/v1/models`,
                )
              : [
                  "https://opencode.ai/zen/go/v1/models",
                  "https://opencode.ai/zen/v1/models",
                ],
          );
        },
      );
    },
  );

  it.each(["opencode-zen", "opencode-go"])(
    "preserves %s pass-through paths and bodies without catalog access",
    async (providerName) => {
      await Environments.runWithConfig(
        { OPENCODE_API_KEY: "example-key" },
        async () => {
          const fetch = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValue(new Response("raw"));
          const context = createTestRoutedContext({
            request: new Request(
              `https://proxy.example/${providerName}/messages?beta=1`,
              {
                method: "POST",
                headers: {
                  "x-api-key": "proxy-secret",
                  "anthropic-version": "example-version",
                },
                body: "raw request",
              },
            ),
          });
          const response = await handleProviderProxyRequest(
            context,
            providerName,
            "/messages?beta=1",
          );
          expect(await response.text()).toBe("raw");
          expect(fetch).toHaveBeenCalledOnce();
          const [url, init] = fetch.mock.lastCall!;
          expect(url).toBe(
            `https://opencode.ai/zen/${providerName === "opencode-go" ? "go/" : ""}v1/messages?beta=1`,
          );
          expect(new Headers(init?.headers).get("x-api-key")).toBe(
            "example-key",
          );
          expect(new Headers(init?.headers).get("anthropic-version")).toBe(
            "example-version",
          );
          expect(await new Response(init?.body).text()).toBe("raw request");
        },
      );
    },
  );
});
