import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudflareAIGateway } from "~/src/ai_gateway";
import { Anthropic } from "~/src/providers/anthropic/provider";
import { AwsBedrock } from "~/src/providers/aws-bedrock/provider";
import { GoogleVertexAi } from "~/src/providers/google-vertex-ai/provider";
import {
  chatCompletionsEndpoint,
  convertedChatEndpoint,
  type ChatConversionCodec,
} from "~/src/providers/inference";
import { messagesEndpoint } from "~/src/providers/native";
import { createProvider, withProviderProfile } from "~/src/providers/provider";
import { handleChatCompletionsRequest } from "~/src/requests/chat_completions";
import { handleMessagesRequest } from "~/src/requests/messages";
import { handleResponsesRequest } from "~/src/requests/responses";
import { Config } from "~/src/utils/config";
import { Environments } from "~/src/utils/environments";
import { buildInferenceRequest } from "../../helpers/provider";
import { createTestRoutedContext } from "../../helpers/request_context";

const gateway = () =>
  new CloudflareAIGateway("account", "gateway", "gateway-example-token");
const chatBody = {
  id: "chat-1",
  object: "chat.completion",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "hello" },
      finish_reason: "stop",
    },
  ],
};
const messageBody = {
  type: "message",
  id: "msg-1",
  content: [{ type: "text", text: "hello" }],
  stop_reason: "end_turn",
  usage: { input_tokens: 1, output_tokens: 1 },
};
const converseBody = {
  output: { message: { content: [{ text: "hello" }] } },
  stopReason: "end_turn",
};
const serviceAccount = {
  type: "service_account",
  project_id: "example-project",
  client_email: "example@example-project.iam.gserviceaccount.com",
  private_key: "example-not-a-private-key",
  region: "us-central1",
};
function context(model: string, overrides: Record<string, unknown> = {}) {
  return createTestRoutedContext({
    request: new Request("https://proxy.test/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: "Bearer client-proxy-token",
        "cf-aig-byok-alias": "untrusted",
        "cf-aig-skip-cache": "true",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 64,
        ...overrides,
      }),
    }),
    apiKeyIndex: 0,
  });
}

describe("native Gateway inference routing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    [
      "openai/model",
      "/openai/chat/completions",
      "OPENAI_API_KEY",
      "authorization",
      "Bearer example-provider-key",
      chatBody,
    ],
    [
      "groq/model",
      "/groq/chat/completions",
      "GROQ_API_KEY",
      "authorization",
      "Bearer example-provider-key",
      chatBody,
    ],
    [
      "openrouter/author/model",
      "/openrouter/v1/chat/completions",
      "OPENROUTER_API_KEY",
      "authorization",
      "Bearer example-provider-key",
      chatBody,
    ],
    [
      "anthropic/model",
      "/anthropic/v1/chat/completions",
      "ANTHROPIC_API_KEY",
      "authorization",
      "Bearer example-provider-key",
      chatBody,
    ],
    [
      "google-ai-studio/model",
      "/google-ai-studio/v1beta/openai/chat/completions",
      "GEMINI_API_KEY",
      "authorization",
      "Bearer example-provider-key",
      chatBody,
    ],
    [
      "aws-bedrock/amazon.nova-lite-v1:0",
      "/aws-bedrock/bedrock-runtime/us-east-1/model/amazon.nova-lite-v1%3A0/converse",
      "AWS_BEARER_TOKEN_BEDROCK",
      "authorization",
      "Bearer example-provider-key",
      converseBody,
    ],
    [
      "aws-bedrock/openai.gpt-oss-20b-1:0",
      "/aws-bedrock/bedrock-runtime/us-east-1/openai/v1/chat/completions",
      "AWS_BEARER_TOKEN_BEDROCK",
      "authorization",
      "Bearer example-provider-key",
      chatBody,
    ],
  ] as const)(
    "routes %s to the provider-specific URL and credential",
    async (model, suffix, keyName, authHeader, authValue, upstream) => {
      const fetch = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(Response.json(upstream));
      await Environments.runWithConfig(
        { [keyName]: "example-provider-key", AWS_BEDROCK_REGION: "us-east-1" },
        async () => {
          const response = await handleChatCompletionsRequest(
            context(model),
            gateway(),
          );
          expect(
            ((await response.json()) as any).choices[0].message.content,
          ).toBe("hello");
        },
      );
      expect(fetch).toHaveBeenCalledOnce();
      const [url, init] = fetch.mock.calls[0];
      expect(url).toBe(
        `https://gateway.ai.cloudflare.com/v1/account/gateway${suffix}`,
      );
      const headers = new Headers(init?.headers);
      expect(headers.get(authHeader)).toBe(authValue);
      expect(headers.get("cf-aig-authorization")).toBe(
        "Bearer gateway-example-token",
      );
      expect(headers.has("cf-aig-byok-alias")).toBe(false);
      expect(headers.get("cf-aig-skip-cache")).toBe("true");
      const body = JSON.parse(String(init?.body));
      const concreteModel = model.slice(model.indexOf("/") + 1);
      expect(JSON.parse(headers.get("cf-aig-metadata")!)).toMatchObject({
        llm_proxy_model: concreteModel,
        llm_proxy_credentials: "default:0",
      });
      if (model.startsWith("google-ai-studio"))
        expect(body).toEqual({
          model: "model",
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 64,
        });
      else if (model.startsWith("aws-bedrock/amazon"))
        expect(body).toEqual({
          messages: [{ role: "user", content: [{ text: "hi" }] }],
          inferenceConfig: { maxTokens: 64 },
        });
      else expect(body.model).toBe(concreteModel);
    },
  );

  it("routes Vertex Google and Anthropic models using the selected service account", async () => {
    await Environments.runWithConfig(
      {
        GOOGLE_VERTEX_AI_SERVICE_ACCOUNT_JSON: {
          paid: [
            serviceAccount,
            {
              ...serviceAccount,
              project_id: "second-project",
              region: "europe-west1",
            },
          ],
        },
      },
      async () => {
        const provider = withProviderProfile(new GoogleVertexAi(), "paid");
        for (const [model, stream, path] of [
          [
            "google/gemini-example",
            false,
            "/endpoints/openapi/chat/completions",
          ],
          ["gemini-example", true, "/endpoints/openapi/chat/completions"],
          [
            "anthropic/claude-example",
            false,
            "/publishers/anthropic/models/claude-example:rawPredict",
          ],
          [
            "anthropic/claude-example",
            true,
            "/publishers/anthropic/models/claude-example:streamRawPredict",
          ],
        ] as const) {
          const [url, init] = (await buildInferenceRequest(provider, {
            data: {
              model,
              messages: [{ role: "user", content: "hi" }],
              max_tokens: 64,
              stream,
            },
            headers: {},
            apiKeyIndex: 1,
            target: "gateway",
          }))!;
          expect(url).toBe(
            `/v1/projects/second-project/locations/europe-west1${path}`,
          );
          const authorization = new Headers(init.headers).get("authorization")!;
          expect(
            JSON.parse(atob(authorization.slice("Bearer ".length))),
          ).toMatchObject({
            project_id: "second-project",
            region: "europe-west1",
          });
          const body = JSON.parse(String(init.body));
          if (model.startsWith("anthropic/")) {
            expect(body).toMatchObject({
              anthropic_version: "vertex-2023-10-16",
              max_tokens: 64,
            });
            expect(body).not.toHaveProperty("model");
          } else
            expect(body).toMatchObject({
              model: "google/gemini-example",
              messages: [{ role: "user", content: "hi" }],
              stream,
            });
        }
        const [defaultPath] = (await buildInferenceRequest(provider, {
          data: { model: "gemini-example", messages: [] },
          headers: {},
          target: "gateway",
        }))!;
        expect(defaultPath).toContain(
          "/projects/example-project/locations/us-central1/",
        );
        await expect(
          buildInferenceRequest(provider, {
            data: { model: "unknown/model", messages: [] },
            headers: {},
            target: "gateway",
          }),
        ).rejects.toThrow("Vertex publisher");
      },
    );
  });

  it("runs Vertex inference through the native codec at the request boundary", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json(messageBody));
    await Environments.runWithConfig(
      { GOOGLE_VERTEX_AI_SERVICE_ACCOUNT_JSON: serviceAccount },
      async () => {
        const response = await handleChatCompletionsRequest(
          context("google-vertex-ai/anthropic/claude-example"),
          gateway(),
        );
        expect(
          ((await response.json()) as any).choices[0].message.content,
        ).toBe("hello");
      },
    );
    expect(fetch.mock.calls[0][0]).toBe(
      "https://gateway.ai.cloudflare.com/v1/account/gateway/google-vertex-ai/v1/projects/example-project/locations/us-central1/publishers/anthropic/models/claude-example:rawPredict",
    );
  });

  it("uses native Anthropic BYOK without a fabricated provider credential", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json(messageBody));
    await Environments.runWithConfig({}, async () => {
      expect(await new Anthropic().headers()).not.toHaveProperty("x-api-key");
      await handleChatCompletionsRequest(
        context("anthropic/claude"),
        gateway(),
      );
    });
    const headers = new Headers(fetch.mock.calls[0][1]?.headers);
    expect(headers.has("authorization")).toBe(false);
    expect(headers.has("x-api-key")).toBe(false);
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
    expect(
      JSON.parse(headers.get("cf-aig-metadata")!).llm_proxy_credentials,
    ).toBe("default:null");
  });

  it("rebuilds native credentials on a retry and respects an explicit slot", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(Response.json(messageBody));
    await Environments.runWithConfig(
      { ANTHROPIC_API_KEY: ["example-key-0", "example-key-1"] },
      async () => {
        const state = context("anthropic/claude");
        state.apiKeyIndex = undefined;
        vi.spyOn(
          state.providers.get("anthropic")!,
          "getNextApiKeyIndex",
        ).mockResolvedValue(0);
        await handleMessagesRequest(state, gateway());
      },
    );
    expect(
      fetch.mock.calls.map(([, init]) =>
        new Headers(init?.headers).get("x-api-key"),
      ),
    ).toEqual(["example-key-0", "example-key-1"]);
    expect(
      fetch.mock.calls.every(([url]) =>
        String(url).endsWith("/anthropic/v1/messages"),
      ),
    ).toBe(true);
    fetch.mockReset().mockResolvedValue(Response.json(messageBody));
    await Environments.runWithConfig(
      { ANTHROPIC_API_KEY: ["example-key-0", "example-key-1"] },
      async () => {
        const state = context("anthropic/claude");
        state.apiKeyIndex = 1;
        await handleMessagesRequest(state, gateway());
      },
    );
    expect(fetch).toHaveBeenCalledOnce();
    expect(new Headers(fetch.mock.calls[0][1]?.headers).get("x-api-key")).toBe(
      "example-key-1",
    );
  });

  it("selects a complete model-specific codec without changing the request handler", async () => {
    const responseProtocol: ChatConversionCodec = {
      prepare(data) {
        return {
          path: "/responses",
          data: { model: data.model, input: data.messages },
        };
      },
      async transformResponse(response, model) {
        const body = (await response.json()) as { output_text: string };
        return Response.json({
          model,
          choices: [{ message: { content: body.output_text } }],
        });
      },
    };
    const provider = createProvider({
      openAICompatible: true,
      chatFallback: convertedChatEndpoint(messagesEndpoint),
      resolveChatFallback(model) {
        return model === "responses-only"
          ? convertedChatEndpoint(responseProtocol)
          : undefined;
      },
    });
    expect(provider.resolveInference("other", "chat_completions")?.native).toBe(
      false,
    );
    const state = context("openai/responses-only");
    vi.spyOn(state.providers, "get").mockReturnValue(provider);
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        Response.json({ output_text: "selected response protocol" }),
      );
    const response = await handleChatCompletionsRequest(state, gateway());
    expect(fetch.mock.calls[0][0]).toBe(
      "https://gateway.ai.cloudflare.com/v1/account/gateway/openai/responses",
    );
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({
      model: "responses-only",
      input: [{ role: "user", content: "hi" }],
    });
    expect(await response.json()).toEqual({
      model: "responses-only",
      choices: [{ message: { content: "selected response protocol" } }],
    });
  });

  it("keeps the selected request and response operations together", async () => {
    const operation = chatCompletionsEndpoint("/vendor/chat", {
      transformResponse: async () => new Response("transformed"),
    });
    const provider = createProvider({
      endpoints: { chat_completions: operation },
    });
    expect(
      provider.resolveInference("any-model", "chat_completions")?.endpoint,
    ).toBe(operation);
    const [url, init] = await operation.buildRequest.call(provider, {
      data: { model: "any-model" },
      headers: {},
      target: "gateway",
    });
    expect(url).toBe("/vendor/chat");
    expect(JSON.parse(String(init.body))).toEqual({ model: "any-model" });
    expect(
      await (
        await operation.transformResponse!.call(
          provider,
          new Response(),
          "any-model",
          {},
        )
      ).text(),
    ).toBe("transformed");
    expect(
      new AwsBedrock().resolveInference("amazon.nova", "chat_completions")
        ?.native,
    ).toBe(false);
  });

  it("preserves public Messages and Responses output while forwarding native Messages upstream", async () => {
    vi.spyOn(Config, "chatResponseMetadataEnabled").mockReturnValue(true);
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => Response.json(messageBody));
    await Environments.runWithConfig(
      { ANTHROPIC_API_KEY: "example-key" },
      async () => {
        for (const protocol of ["messages", "responses"] as const) {
          const state = createTestRoutedContext({
            request: new Request(`https://proxy.test/v1/${protocol}`, {
              method: "POST",
              body: JSON.stringify(
                protocol === "messages"
                  ? {
                      model: "anthropic/claude",
                      messages: [{ role: "user", content: "hi" }],
                      max_tokens: 64,
                    }
                  : {
                      model: "anthropic/claude",
                      input: "hi",
                      max_output_tokens: 64,
                    },
              ),
            }),
          });
          const response = await (protocol === "messages"
            ? handleMessagesRequest(state, gateway())
            : handleResponsesRequest(state, gateway()));
          const body = (await response.json()) as any;
          expect(protocol === "messages" ? body.type : body.object).toBe(
            protocol === "messages" ? "message" : "response",
          );
          expect(JSON.stringify(body)).toContain("hello");
          if (protocol === "messages") {
            expect(body).toEqual(messageBody);
          } else {
            expect(body.llm_proxy).toMatchObject({
              provider: "anthropic",
              via_ai_gateway: true,
            });
          }
        }
      },
    );
    expect(
      fetch.mock.calls.every(([url]) =>
        String(url).endsWith("/anthropic/v1/messages"),
      ),
    ).toBe(true);
  });
});
