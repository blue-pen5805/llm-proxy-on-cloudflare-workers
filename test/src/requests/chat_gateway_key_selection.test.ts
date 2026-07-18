import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudflareAIGateway } from "~/src/ai_gateway";
import type { MiddlewareContext } from "~/src/middleware";
import { createProvider } from "~/src/providers/provider";
import { handleChatCompletionsRequest } from "~/src/requests/chat_completions";

const API_KEYS = ["provider-key-0", "provider-key-1", "provider-key-2"];

function createContext(
  selection?: MiddlewareContext["apiKeyIndex"],
  providerName = "openai",
): MiddlewareContext {
  const provider = createProvider({
    openAICompatible: true,
    baseUrl: "https://api.example.com/v1",
    getApiKeys: () => API_KEYS,
    getAiGatewayApiKeys: () => API_KEYS,
    getNextApiKeyIndex: async () => 0,
  });
  const request = new Request("https://proxy.example/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-aig-authorization": "Bearer client-gateway-token",
      "cf-aig-skip-cache": "true",
    },
    body: JSON.stringify({ model: `${providerName}/model`, messages: [] }),
  });

  return {
    request,
    env: {} as Env,
    ctx: {} as ExecutionContext,
    pathname: "/v1/chat/completions",
    apiKeyIndex: selection,
    providers: {
      get: () => provider,
    } as MiddlewareContext["providers"],
  };
}

function authorizationHeaders(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map(([, init]) =>
    new Headers(init?.headers).get("authorization"),
  );
}

describe("Gateway chat key selection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses an explicitly selected index as the only Gateway credential", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok"));
    vi.spyOn(console, "info").mockImplementation(() => {});

    await handleChatCompletionsRequest(
      createContext(2),
      new CloudflareAIGateway("account", "gateway", "operator-gateway-token"),
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(authorizationHeaders(fetchMock)).toEqual(["Bearer provider-key-2"]);
    expect(
      new Headers(fetchMock.mock.calls[0][1]?.headers).get(
        "cf-aig-authorization",
      ),
    ).toBe("Bearer operator-gateway-token");
  });

  it("uses the result of an explicit range as the only Gateway credential", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok"));
    vi.spyOn(console, "info").mockImplementation(() => {});

    await handleChatCompletionsRequest(
      createContext({ start: 1, end: 1 }),
      new CloudflareAIGateway("account", "gateway", "operator-gateway-token"),
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(authorizationHeaders(fetchMock)).toEqual(["Bearer provider-key-1"]);
  });

  it("retains automatic Gateway credential fallback", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(new Response("ok"));
    vi.spyOn(console, "info").mockImplementation(() => {});

    await handleChatCompletionsRequest(
      createContext(),
      new CloudflareAIGateway("account", "gateway", "operator-gateway-token"),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authorizationHeaders(fetchMock)).toEqual([
      "Bearer provider-key-0",
      "Bearer provider-key-1",
    ]);
  });

  it("retains the verified OpenRouter Compatibility Endpoint route", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok"));
    vi.spyOn(console, "info").mockImplementation(() => {});

    await handleChatCompletionsRequest(
      createContext(undefined, "openrouter"),
      new CloudflareAIGateway("account", "gateway", "operator-gateway-token"),
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://gateway.ai.cloudflare.com/v1/account/gateway/compat/chat/completions",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      model: "openrouter/model",
    });
  });
});
