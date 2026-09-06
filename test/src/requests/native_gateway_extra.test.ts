import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudflareAIGateway } from "~/src/ai_gateway";
import { CustomOpenAI } from "~/src/providers/custom-openai";
import {
  chatCompletionsEndpoint,
  jsonEndpoint,
} from "~/src/providers/inference";
import { transformNativeResponse } from "~/src/providers/native";
import { createProvider } from "~/src/providers/provider";
import { handleChatCompletionsRequest } from "~/src/requests/chat_completions";
import { Environments } from "~/src/utils/environments";
import { buildInferenceRequest } from "../../helpers/provider";
import { createTestRoutedContext } from "../../helpers/request_context";

function context(model: string, extra: Record<string, unknown> = {}) {
  return createTestRoutedContext({
    request: new Request("https://proxy.test/v1/chat/completions", {
      method: "POST",
      headers: { "cf-aig-gateway-id": "untrusted" },
      body: JSON.stringify({ model, messages: [], ...extra }),
    }),
    apiKeyIndex: 0,
  });
}
describe("native Gateway transport contracts", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses Workers AI's own account API, selected key and Gateway ID", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ choices: [] }));
    await Environments.runWithConfig(
      { CLOUDFLARE_API_KEY: "example-workers-key" },
      async () => {
        await handleChatCompletionsRequest(
          context("workers-ai/@cf/example/model"),
          new CloudflareAIGateway("account", "selected", "gateway-key"),
        );
      },
    );
    expect(fetch.mock.calls[0][0]).toBe(
      "https://api.cloudflare.com/client/v4/accounts/account/ai/v1/chat/completions",
    );
    const headers = new Headers(fetch.mock.calls[0][1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer example-workers-key");
    expect(headers.get("cf-aig-gateway-id")).toBe("selected");
    expect(headers.has("cf-aig-authorization")).toBe(false);
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({
      model: "@cf/example/model",
      messages: [],
    });
  });

  it("rejects missing Workers AI credentials and third-party catalog selectors", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    await Environments.runWithConfig({}, async () => {
      await expect(
        handleChatCompletionsRequest(
          context("workers-ai/@cf/example/model"),
          new CloudflareAIGateway("account", "g"),
        ),
      ).rejects.toThrow("workers-ai is not configured");
      await expect(
        handleChatCompletionsRequest(
          context("workers-ai/openai/model"),
          new CloudflareAIGateway("account", "g"),
        ),
      ).rejects.toThrow("non-Workers-AI model selectors");
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses Perplexity's native Chat Completions path", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok"));
    await Environments.runWithConfig(
      { PERPLEXITYAI_API_KEY: "example-key" },
      async () => {
        expect(
          await (
            await handleChatCompletionsRequest(
              context("perplexity-ai/sonar"),
              new CloudflareAIGateway("account", "g"),
            )
          ).text(),
        ).toBe("ok");
      },
    );
    expect(fetch.mock.calls[0][0]).toBe(
      "https://gateway.ai.cloudflare.com/v1/account/g/perplexity-ai/chat/completions",
    );
  });

  it("preserves strict Custom Provider routing and its selected credential metadata", async () => {
    const provider = new CustomOpenAI({
      name: "example",
      baseUrl: "https://provider.test/v1",
      apiKeys: ["example-key-0", "example-key-1"],
    });
    const state = context("example/model");
    state.apiKeyIndex = 1;
    vi.spyOn(state.providers, "get").mockReturnValue(provider);
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok"));
    await handleChatCompletionsRequest(
      state,
      new CloudflareAIGateway("account", "g", undefined, undefined, true),
    );
    expect(fetch.mock.calls[0][0]).toBe(
      "https://gateway.ai.cloudflare.com/v1/account/g/custom-llm-proxy-example/v1/chat/completions",
    );
    const headers = new Headers(fetch.mock.calls[0][1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer example-key-1");
    expect(
      JSON.parse(headers.get("cf-aig-metadata")!).llm_proxy_credentials,
    ).toBe("default:1");
  });

  it("does not send an unsupported chat operation to a provider root", async () => {
    const provider = createProvider();
    await expect(
      buildInferenceRequest(provider, {
        data: { model: "m" },
        headers: {},
        target: "gateway",
      }),
    ).rejects.toThrow("does not support Chat Completions");
  });

  it("converts a native JSON response without a Content-Type header", async () => {
    const source = new Response(
      new TextEncoder().encode(
        JSON.stringify({ content: [{ type: "text", text: "hello" }] }),
      ),
    );
    expect(source.headers.has("content-type")).toBe(false);
    const result = await transformNativeResponse(source, "messages", "m", {});
    expect(result.status).toBe(200);
    expect(result.headers.get("content-type")).toBe("application/json");
  });

  it("respects an operation's path prefix choice on Custom Gateway routes", async () => {
    const provider = createProvider({
      baseUrl: "https://api.example.test/v2",
      pathnamePrefix: "/compatibility",
      requiresCustomAiGatewayProvider: true,
      endpoints: {
        chat_completions: jsonEndpoint("/native/chat", {
          usePathnamePrefix: false,
        }),
      },
    });
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok"));
    const state = context("custom-model/model");
    vi.spyOn(state.providers, "get").mockReturnValue(provider);
    const gateway = new CloudflareAIGateway(
      "account",
      "g",
      "gateway-key",
      undefined,
      true,
    );
    const response = await handleChatCompletionsRequest(state, gateway);
    expect(response.status).toBe(200);
    expect(String(fetch.mock.calls[0][0])).toBe(
      "https://gateway.ai.cloudflare.com/v1/account/g/custom-llm-proxy-custom-model/v2/native/chat",
    );
  });

  it("prepares only a credential that is actually attempted", async () => {
    const headers = vi.fn(async (index?: number) => ({
      authorization: `Bearer example-${index}`,
    }));
    const provider = createProvider({
      endpoints: { chat_completions: chatCompletionsEndpoint() },
      getApiKeys: () => ["a", "b", "c"],
      getNextApiKeyIndex: async () => 0,
      headers,
    });
    const state = context("openai/m");
    state.apiKeyIndex = undefined;
    vi.spyOn(state.providers, "get").mockReturnValue(provider);
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok"));
    await handleChatCompletionsRequest(
      state,
      new CloudflareAIGateway("account", "g"),
    );
    expect(fetch).toHaveBeenCalledOnce();
    expect(headers).toHaveBeenCalledOnce();
    expect(headers).toHaveBeenCalledWith(0);
  });
});

describe("direct endpoint execution", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses direct Anthropic Chat Completions and authenticates the selected operation once", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        id: "chat-direct",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "direct answer" },
            finish_reason: "stop",
          },
        ],
      }),
    );
    await Environments.runWithConfig(
      { ANTHROPIC_API_KEY: "example-key" },
      async () => {
        const state = context("anthropic/claude-example", {
          max_tokens: 32,
          messages: [{ role: "user", content: "hi" }],
        });
        const provider = state.providers.get("anthropic")!;
        const resolve = vi.spyOn(provider, "resolveInference");
        const headers = vi.spyOn(provider, "headers");
        const response = await handleChatCompletionsRequest(state);
        expect((await response.json()) as any).toMatchObject({
          choices: [{ message: { content: "direct answer" } }],
        });
        expect(resolve).toHaveBeenCalledExactlyOnceWith(
          "claude-example",
          "chat_completions",
        );
        expect(headers).toHaveBeenCalledExactlyOnceWith(0);
      },
    );
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe(
      "https://api.anthropic.com/v1/chat/completions",
    );
    const init = fetch.mock.calls[0][1]!;
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer example-key",
    );
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "claude-example",
      max_tokens: 32,
      messages: [{ role: "user", content: "hi" }],
    });
  });

  it("converts direct Bedrock Converse using the selected credential profile", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        output: {
          message: { role: "assistant", content: [{ text: "direct answer" }] },
        },
        stopReason: "end_turn",
        usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
      }),
    );
    await Environments.runWithConfig(
      {
        AWS_BEARER_TOKEN_BEDROCK: { paid: ["example-paid-key"] },
        AWS_BEDROCK_REGION: "us-east-1",
      },
      async () => {
        const response = await handleChatCompletionsRequest(
          context("aws-bedrock:paid/amazon.nova", {
            messages: [{ role: "user", content: "hi" }],
          }),
        );
        expect((await response.json()) as any).toMatchObject({
          choices: [{ message: { content: "direct answer" } }],
        });
      },
    );
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe(
      "https://bedrock-runtime.us-east-1.amazonaws.com/model/amazon.nova/converse",
    );
    expect(
      new Headers(fetch.mock.calls[0][1]?.headers).get("authorization"),
    ).toBe("Bearer example-paid-key");
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({
      messages: [{ role: "user", content: [{ text: "hi" }] }],
    });
  });

  it("uses the Bedrock OpenAI API directly for OpenAI models", async () => {
    const body = {
      id: "chat-direct",
      choices: [{ message: { content: "native answer" } }],
    };
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json(body));
    await Environments.runWithConfig(
      {
        AWS_BEARER_TOKEN_BEDROCK: "example-key",
        AWS_BEDROCK_REGION: "us-east-1",
      },
      async () => {
        const response = await handleChatCompletionsRequest(
          context("aws-bedrock/openai.gpt-oss-20b-1:0"),
        );
        expect(await response.json()).toEqual(body);
      },
    );
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe(
      "https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1/chat/completions",
    );
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).model).toBe(
      "openai.gpt-oss-20b-1:0",
    );
  });

  it.each(["replicate"])(
    "rejects undeclared %s inference before network I/O",
    async (providerName) => {
      const fetch = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("Unexpected upstream request"));
      await Environments.runWithConfig({}, async () => {
        const response = await handleChatCompletionsRequest(
          context(`${providerName}/model`),
        );
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
          error: {
            message: `${providerName} does not support chat_completions.`,
          },
        });
      });
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
