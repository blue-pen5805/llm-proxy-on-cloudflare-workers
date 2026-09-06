import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudflareAIGateway } from "~/src/ai_gateway";
import { ProviderRegistry } from "~/src/providers/registry";
import { handleMessagesRequest } from "~/src/requests/messages";
import { handleResponsesRequest } from "~/src/requests/responses";
import { Config } from "~/src/utils/config";
import { Environments } from "~/src/utils/environments";
import { createTestRoutedContext } from "../../helpers/request_context";

const protocols = [
  {
    name: "responses",
    field: "responsesPath",
    handler: handleResponsesRequest,
    body: {
      input: "hello",
      previous_response_id: "resp_previous",
      tools: [{ type: "web_search" }],
    },
  },
  {
    name: "messages",
    field: "messagesPath",
    handler: handleMessagesRequest,
    body: { messages: [], max_tokens: 64, thinking: { type: "adaptive" } },
  },
] as const;

function context(body: object) {
  return createTestRoutedContext({
    request: new Request("https://proxy.example/v1/inference", {
      method: "POST",
      headers: {
        authorization: "Bearer example-proxy-key",
        cookie: "private=cookie",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    }),
    providers: new ProviderRegistry({}, Config.customOpenAIEndpoints()),
    apiKeyIndex: 1,
  });
}

describe.each(protocols)(
  "custom native $name",
  ({ name, field, handler, body }) => {
    afterEach(() => vi.restoreAllMocks());

    it.each(["direct", "non-strict", "strict"])(
      "preserves JSON and SSE via %s routing",
      async (mode) => {
        const fetch = vi.spyOn(globalThis, "fetch");
        await Environments.runWithConfig(
          {
            CUSTOM_OPENAI_ENDPOINTS: [
              {
                name: "custom",
                baseUrl: "https://upstream.example/root/v2",
                [field]: `/native/${name}`,
                apiKeys: {
                  default: ["example-default"],
                  paid: ["example-paid-0", "example-paid-1"],
                },
              },
            ],
          },
          async () => {
            for (const stream of [false, true]) {
              const output = stream
                ? `event: native.event\ndata: {"native":true}\n\n`
                : JSON.stringify({ native: true });
              const upstream = new Response(output, {
                headers: {
                  "content-type": stream
                    ? "text/event-stream"
                    : "application/json",
                },
              });
              fetch.mockResolvedValueOnce(upstream);
              const gateway =
                mode === "direct"
                  ? undefined
                  : new CloudflareAIGateway(
                      "account",
                      "gateway",
                      "example-gateway-key",
                      undefined,
                      mode === "strict",
                    );
              const response = await handler(
                context({ model: "custom:paid/vendor/model", ...body, stream }),
                gateway,
              );
              expect(response).toBe(upstream);
              expect(await response.text()).toBe(output);
              const [url, init] = fetch.mock.lastCall!;
              expect(String(url)).toBe(
                mode === "strict"
                  ? `https://gateway.ai.cloudflare.com/v1/account/gateway/custom-llm-proxy-custom/v2/native/${name}`
                  : `https://upstream.example/root/v2/native/${name}`,
              );
              expect(JSON.parse(String(init!.body))).toEqual({
                model: "vendor/model",
                ...body,
                stream,
              });
              const headers = new Headers(init!.headers);
              expect(headers.get("authorization")).toBe(
                "Bearer example-paid-1",
              );
              expect(headers.has("cookie")).toBe(false);
              expect(headers.has("cf-aig-authorization")).toBe(
                mode === "strict",
              );
              if (name === "messages")
                expect(headers.get("anthropic-version")).toBe("2023-06-01");
            }
          },
        );
        expect(fetch).toHaveBeenCalledTimes(2);
      },
    );

    it("preserves upstream errors without retrying through Chat", async () => {
      const upstream = Response.json(
        { error: "unsupported native model" },
        { status: 404 },
      );
      const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(upstream);
      await Environments.runWithConfig(
        {
          CUSTOM_OPENAI_ENDPOINTS: [
            {
              name: "custom",
              baseUrl: "https://upstream.example",
              [field]: `/native/${name}`,
            },
          ],
        },
        async () => {
          expect(
            await handler(context({ model: "custom/model", ...body })),
          ).toBe(upstream);
        },
      );
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(String(fetch.mock.calls[0]![0])).toBe(
        `https://upstream.example/native/${name}`,
      );
    });

    it("converts through the configured Chat path when the native path is omitted", async () => {
      const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        Response.json({
          id: "chat_1",
          model: "model",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "hello" },
              finish_reason: "stop",
            },
          ],
        }),
      );
      await Environments.runWithConfig(
        {
          CUSTOM_OPENAI_ENDPOINTS: [
            {
              name: "custom",
              baseUrl: "https://upstream.example",
              chatCompletionPath: "/legacy/chat",
            },
          ],
        },
        async () => {
          const request =
            name === "responses"
              ? { input: "hello" }
              : {
                  messages: [{ role: "user", content: "hello" }],
                  max_tokens: 64,
                };
          const response = await handler(
            context({ model: "custom/model", ...request }),
          );
          expect(response.status).toBe(200);
          expect(await response.json()).toMatchObject(
            name === "responses" ? { object: "response" } : { type: "message" },
          );
        },
      );
      expect(String(fetch.mock.calls[0]![0])).toBe(
        "https://upstream.example/legacy/chat",
      );
      expect(JSON.parse(String(fetch.mock.calls[0]![1]!.body))).toMatchObject({
        model: "model",
        messages: [{ role: "user", content: "hello" }],
      });
    });
  },
);
