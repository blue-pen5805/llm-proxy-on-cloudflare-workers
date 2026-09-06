import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudflareAIGateway } from "~/src/ai_gateway";
import { customProviderRoute } from "~/src/ai_gateway/custom_provider";
import { AwsBedrock } from "~/src/providers/aws-bedrock/provider";
import { DeepSeek } from "~/src/providers/deepseek/provider";
import { GoogleVertexAi } from "~/src/providers/google-vertex-ai/provider";
import { HuggingFace } from "~/src/providers/huggingface/provider";
import { PerplexityAi } from "~/src/providers/perplexity-ai/provider";
import { handleChatCompletionsRequest } from "~/src/requests/chat_completions";
import { handleMessagesRequest } from "~/src/requests/messages";
import { handleResponsesRequest } from "~/src/requests/responses";
import { Environments } from "~/src/utils/environments";
import { createTestRoutedContext } from "../../helpers/request_context";

const gateway = () =>
  new CloudflareAIGateway("account", "gateway", "example-token");
const fixtures = [
  [
    "deepseek",
    "deepseek-v4-flash",
    "responses",
    "https://api.deepseek.com/responses",
    "/deepseek/responses",
    "DEEPSEEK_API_KEY",
    "authorization",
  ],
  [
    "deepseek",
    "deepseek-v4-pro",
    "messages",
    "https://api.deepseek.com/anthropic/v1/messages",
    "/deepseek/anthropic/v1/messages",
    "DEEPSEEK_API_KEY",
    "x-api-key",
  ],
  [
    "perplexity-ai",
    "openai/gpt-5.6-sol",
    "responses",
    "https://api.perplexity.ai/v1/responses",
    "/perplexity-ai/v1/responses",
    "PERPLEXITYAI_API_KEY",
    "authorization",
  ],
  [
    "perplexity-ai",
    "openai/gpt-5.6-sol",
    "chat",
    "https://api.perplexity.ai/v1/chat/completions",
    "/perplexity-ai/v1/chat/completions",
    "PERPLEXITYAI_API_KEY",
    "authorization",
  ],
  [
    "aws-bedrock",
    "us.openai.gpt-5.6-sol",
    "responses",
    "https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1/responses",
    "/aws-bedrock/bedrock-runtime/us-east-1/openai/v1/responses",
    "AWS_BEARER_TOKEN_BEDROCK",
    "authorization",
  ],
  [
    "aws-bedrock",
    "global.anthropic.claude-sonnet-5",
    "messages",
    "https://bedrock-runtime.us-east-1.amazonaws.com/anthropic/v1/messages",
    "/aws-bedrock/bedrock-runtime/us-east-1/anthropic/v1/messages",
    "AWS_BEARER_TOKEN_BEDROCK",
    "x-api-key",
  ],
  [
    "aws-bedrock",
    "us.anthropic.claude-sonnet-4-6",
    "chat",
    "https://bedrock-runtime.us-east-1.amazonaws.com/v1/chat/completions",
    "/aws-bedrock/bedrock-runtime/us-east-1/v1/chat/completions",
    "AWS_BEARER_TOKEN_BEDROCK",
    "authorization",
  ],
] as const;
const handlers = {
  responses: handleResponsesRequest,
  messages: handleMessagesRequest,
  chat: handleChatCompletionsRequest,
};
function context(model: string, body: Record<string, unknown>) {
  return createTestRoutedContext({
    request: new Request("https://proxy.test/v1/responses", {
      method: "POST",
      headers: {
        authorization: "Bearer example-proxy-key",
        cookie: "private=cookie",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model, ...body }),
    }),
    apiKeyIndex: 1,
  });
}

describe("built-in matching API declarations", () => {
  afterEach(() => vi.restoreAllMocks());
  it.each(fixtures)(
    "preserves %s %s %s through direct and Gateway routing",
    async (provider, model, protocol, direct, suffix, keyName, authHeader) => {
      const fetch = vi.spyOn(globalThis, "fetch");
      await Environments.runWithConfig(
        {
          [keyName]: { paid: ["example-key-0", "example-key-1"] },
          AWS_BEDROCK_REGION: "us-east-1",
        },
        async () => {
          for (const useGateway of [false, true]) {
            for (const stream of [false, true]) {
              const body = {
                ...(protocol === "responses"
                  ? { input: "hello", previous_response_id: "resp_previous" }
                  : {
                      messages: [{ role: "user", content: "hello" }],
                      max_tokens: 64,
                    }),
                stream,
                extra_body: { keep: true },
              };
              const output = stream
                ? 'event: native_extension\ndata: {"preserved":true}\n\n'
                : '{"native_output":true}';
              const upstream = new Response(output, {
                headers: {
                  "content-type": stream
                    ? "text/event-stream"
                    : "application/json",
                },
              });
              fetch.mockResolvedValueOnce(upstream);
              const response = await handlers[protocol](
                context(`${provider}:paid/${model}`, body),
                useGateway ? gateway() : undefined,
              );
              expect(response).toBe(upstream);
              expect(await response.text()).toBe(output);
              const [url, init] = fetch.mock.lastCall!;
              expect(String(url)).toBe(
                useGateway
                  ? `https://gateway.ai.cloudflare.com/v1/account/gateway${suffix}`
                  : direct,
              );
              expect(JSON.parse(String(init!.body))).toEqual({
                model,
                ...body,
              });
              const headers = new Headers(init!.headers);
              expect(headers.get(authHeader)).toBe(
                authHeader === "authorization"
                  ? "Bearer example-key-1"
                  : "example-key-1",
              );
              expect(
                headers.has(
                  authHeader === "authorization"
                    ? "x-api-key"
                    : "authorization",
                ),
              ).toBe(false);
              expect(headers.has("cookie")).toBe(false);
            }
            const upstream = Response.json(
              { error: { native_code: "unsupported_model" } },
              { status: 400 },
            );
            fetch.mockResolvedValueOnce(upstream);
            expect(
              await handlers[protocol](
                context(
                  `${provider}:paid/${model}`,
                  protocol === "responses"
                    ? { input: "hello" }
                    : { messages: [], max_tokens: 64 },
                ),
                useGateway ? gateway() : undefined,
              ),
            ).toBe(upstream);
          }
        },
      );
      expect(fetch).toHaveBeenCalledTimes(6);
    },
  );

  it.each([
    [
      "azure-openai",
      "deployment",
      "responses",
      "AZURE_OPENAI_API_KEY",
      "https://example-resource.openai.azure.com",
      "/openai/v1/responses",
      "azure-openai",
      "api-key",
    ],
    [
      "huggingface",
      "author/model:preferred",
      "responses",
      "HUGGINGFACE_API_KEY",
      "https://router.huggingface.co",
      "/v1/responses",
      "huggingface/inference",
      "authorization",
    ],
    [
      "huggingface",
      "author/model",
      "messages",
      "HUGGINGFACE_API_KEY",
      "https://router.huggingface.co",
      "/v1/messages",
      "huggingface/inference",
      "authorization",
    ],
    [
      "huggingface",
      "author/model",
      "chat",
      "HUGGINGFACE_API_KEY",
      "https://router.huggingface.co",
      "/v1/chat/completions",
      "huggingface/inference",
      "authorization",
    ],
  ] as const)(
    "routes %s %s %s with an operation-specific Gateway capability",
    async (
      name,
      model,
      protocol,
      keyName,
      origin,
      path,
      customName,
      authHeader,
    ) => {
      const fetch = vi.spyOn(globalThis, "fetch");
      await Environments.runWithConfig(
        {
          [keyName]: { paid: ["example-key-0", "example-key-1"] },
          AZURE_OPENAI_RESOURCE_NAME: "example-resource",
        },
        async () => {
          for (const mode of ["direct", "gateway", "strict"]) {
            for (const stream of [false, true]) {
              const body = {
                ...(protocol === "responses"
                  ? { input: "hello", previous_response_id: "resp_previous" }
                  : { messages: [], max_tokens: 64 }),
                stream,
                native_option: { keep: true },
              };
              const output = stream
                ? 'event: native_extension\ndata: {"preserved":true}\n\n'
                : '{"native_output":true}';
              const upstream = new Response(output, {
                headers: {
                  "content-type": stream
                    ? "text/event-stream"
                    : "application/json",
                },
              });
              fetch.mockResolvedValueOnce(upstream);
              const response = await handlers[protocol](
                context(`${name}:paid/${model}`, body),
                mode === "direct"
                  ? undefined
                  : new CloudflareAIGateway(
                      "account",
                      "gateway",
                      "example-token",
                      undefined,
                      mode === "strict",
                    ),
              );
              expect(response).toBe(upstream);
              expect(await response.text()).toBe(output);
              const [url, init] = fetch.mock.lastCall!;
              expect(String(url)).toBe(
                mode === "strict"
                  ? `https://gateway.ai.cloudflare.com/v1/account/gateway/${customProviderRoute(customName)}${path}`
                  : origin + path,
              );
              expect(JSON.parse(String(init!.body))).toEqual({
                model,
                ...body,
              });
              const headers = new Headers(init!.headers);
              expect(headers.get(authHeader)).toBe(
                authHeader === "authorization"
                  ? "Bearer example-key-1"
                  : "example-key-1",
              );
              expect(headers.has("cf-aig-authorization")).toBe(
                mode === "strict",
              );
              expect(headers.has("cookie")).toBe(false);
            }
          }
        },
      );
      expect(fetch).toHaveBeenCalledTimes(6);
    },
  );

  it("keeps Hugging Face pass-through independent from inference routing", async () => {
    await Environments.runWithConfig({}, async () => {
      const provider = new HuggingFace();
      expect(provider.baseUrl()).toBe(
        "https://api-inference.huggingface.co/models",
      );
      expect(provider.endpoints.chat_completions?.path).toBeUndefined();
      expect(provider.endpoints.models).toBeUndefined();
      expect(
        new Headers(await provider.buildHeadersForPath("/v1/messages", {})).has(
          "authorization",
        ),
      ).toBe(false);
      expect(
        new Headers(
          await provider.buildHeadersForPath("/author/model", {
            "x-example": "preserved",
          }),
        ).get("x-example"),
      ).toBe("preserved");
    });
  });

  it("selects Vertex Chat and preserves the selected account and native fields", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const serviceAccount = {
      type: "service_account",
      project_id: "example-project",
      region: "us-central1",
      client_email: "example@example.test",
      private_key: "example-not-a-key",
    };
    await Environments.runWithConfig(
      {
        GOOGLE_VERTEX_AI_SERVICE_ACCOUNT_JSON: {
          paid: [
            serviceAccount,
            {
              ...serviceAccount,
              project_id: "selected-project",
              region: "europe-west1",
            },
          ],
        },
      },
      async () => {
        for (const model of ["gemini-example", "google/gemini-example"]) {
          for (const stream of [false, true]) {
            const output = stream
              ? 'data: {"choices":[]}\n\ndata: [DONE]\n\n'
              : '{"choices":[],"native":true}';
            const upstream = new Response(output, {
              headers: {
                "content-type": stream
                  ? "text/event-stream"
                  : "application/json",
              },
            });
            fetch.mockResolvedValueOnce(upstream);
            const body = {
              messages: [{ role: "developer", content: "hello" }],
              stream,
              extra_body: {
                google: { thinking_config: { include_thoughts: true } },
              },
            };
            const response = await handleChatCompletionsRequest(
              context(`google-vertex-ai:paid/${model}`, body),
              gateway(),
            );
            expect(response).toBe(upstream);
            expect(await response.text()).toBe(output);
            const [url, init] = fetch.mock.lastCall!;
            expect(String(url)).toBe(
              "https://gateway.ai.cloudflare.com/v1/account/gateway/google-vertex-ai/v1/projects/selected-project/locations/europe-west1/endpoints/openapi/chat/completions",
            );
            expect(JSON.parse(String(init!.body))).toEqual({
              model: "google/gemini-example",
              ...body,
            });
            expect(
              JSON.parse(
                atob(new Headers(init!.headers).get("authorization")!.slice(7)),
              ).project_id,
            ).toBe("selected-project");
          }
        }
      },
    );
  });

  it("uses Vertex GenerateContent only when the public protocol has no match", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        candidates: [
          { content: { parts: [{ text: "hello" }] }, finishReason: "STOP" },
        ],
      }),
    );
    await Environments.runWithConfig(
      {
        GOOGLE_VERTEX_AI_SERVICE_ACCOUNT_JSON: {
          type: "service_account",
          project_id: "example-project",
          region: "us-central1",
          client_email: "example@example.test",
          private_key: "example-not-a-key",
        },
      },
      async () => {
        const state = context("google-vertex-ai/google/gemini-example", {
          input: "hello",
        });
        state.apiKeyIndex = 0;
        expect(
          (
            (await (
              await handleResponsesRequest(state, gateway())
            ).json()) as any
          ).object,
        ).toBe("response");
      },
    );
    expect(String(fetch.mock.lastCall![0])).toContain(
      "/publishers/google/models/gemini-example:generateContent",
    );
    expect(JSON.parse(String(fetch.mock.lastCall![1]!.body)).contents).toEqual([
      { role: "user", parts: [{ text: "hello" }] },
    ]);
  });

  it("retains model-specific conversion defaults for other APIs", async () => {
    const bedrock = new AwsBedrock();
    for (const model of [
      "openai.gpt-oss-120b-1:0",
      "us-gov.openai.gpt-oss-120b-1:0",
    ]) {
      expect((await bedrock.resolveInference(model, "responses"))?.native).toBe(
        true,
      );
      expect((await bedrock.resolveInference(model, "messages"))?.native).toBe(
        false,
      );
    }
    expect(
      (await bedrock.resolveInference("anthropic.claude", "responses"))?.native,
    ).toBe(false);
    expect(
      (await bedrock.resolveInference("amazon.nova", "chat_completions"))
        ?.native,
    ).toBe(false);
    expect(
      (await new PerplexityAi().resolveInference("sonar", "responses"))?.native,
    ).toBe(false);
    expect(
      (
        await new GoogleVertexAi().resolveInference(
          "google/gemini",
          "responses",
        )
      )?.native,
    ).toBe(false);
  });

  it.each([new DeepSeek(), new AwsBedrock()])(
    "omits missing Messages credentials and retains an explicit version",
    async (provider) => {
      await Environments.runWithConfig({}, async () => {
        const headers = new Headers(
          await provider.buildHeadersForPath("/anthropic/v1/messages", {
            "anthropic-version": "example-version",
          }),
        );
        expect(headers.has("x-api-key")).toBe(false);
        expect(headers.has("authorization")).toBe(false);
        expect(headers.get("anthropic-version")).toBe("example-version");
        const defaults = new Headers(
          await provider.buildHeadersForPath("/anthropic/v1/messages", {}),
        );
        if (provider instanceof AwsBedrock)
          expect(defaults.get("anthropic-version")).toBe("2023-06-01");
      });
    },
  );
});
