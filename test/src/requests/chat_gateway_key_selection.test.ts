import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudflareAIGateway } from "~/src/ai_gateway";
import { createProvider } from "~/src/providers/provider";
import type {
  ApiKeySelection,
  RoutedRequestContext,
} from "~/src/request_context";
import { handleChatCompletionsRequest } from "~/src/requests/chat_completions";
import { createTestRoutedContext } from "../../helpers/request_context";

const API_KEYS = ["provider-key-0", "provider-key-1", "provider-key-2"];

function createContext(
  selection?: ApiKeySelection,
  providerName = "openai",
  automaticIndex = 0,
  apiKeys: string[] = API_KEYS,
  gatewayApiKeys: string[] = apiKeys,
): RoutedRequestContext {
  const provider = createProvider({
    openAICompatible: true,
    baseUrl: "https://api.example.com/v1",
    getApiKeys: () => apiKeys,
    getAiGatewayApiKeys: () => gatewayApiKeys,
    getNextApiKeyIndex: async () => automaticIndex,
  });
  const request = new Request("https://proxy.example/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-aig-authorization": "Bearer client-gateway-token",
      "cf-aig-byok-alias": "privileged-key",
      "cf-aig-skip-cache": "true",
    },
    body: JSON.stringify({ model: `${providerName}/model`, messages: [] }),
  });

  const context = createTestRoutedContext({
    request,
    pathname: "/v1/chat/completions",
    apiKeyIndex: selection,
  });
  vi.spyOn(context.providers, "get").mockReturnValue(provider);
  return context;
}

function authorizationHeaders(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map(
    ([, init]) => new Headers(init?.headers).get("authorization") ?? "",
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
    expect(
      new Headers(fetchMock.mock.calls[0][1]?.headers).has("cf-aig-byok-alias"),
    ).toBe(false);
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
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});

    await handleChatCompletionsRequest(
      createContext(undefined, "openai", 2),
      new CloudflareAIGateway("account", "gateway", "operator-gateway-token"),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const attemptedCredentials = authorizationHeaders(fetchMock);
    expect(attemptedCredentials[0]).toBe("Bearer provider-key-2");
    expect(attemptedCredentials[1]).toMatch(/^Bearer provider-key-[01]$/);

    const selectionRecords = consoleInfo.mock.calls
      .map(([record]) => record as Record<string, unknown>)
      .filter((record) => record.event === "provider.key.selected");
    expect(selectionRecords.map((record) => record.key_index)).toEqual([
      2,
      Number(attemptedCredentials[1].slice(-1)),
    ]);
    const subrequestRecords = consoleInfo.mock.calls
      .map(([record]) => record as Record<string, unknown>)
      .filter(
        (record) =>
          record.event === "subrequest.started" ||
          record.event === "subrequest.completed",
      );
    expect(subrequestRecords).toHaveLength(4);
    expect(subrequestRecords.every((record) => record.model === "model")).toBe(
      true,
    );
  });

  it("includes the model in direct provider subrequest lifecycle logs", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});

    await handleChatCompletionsRequest(createContext());

    const subrequestRecords = consoleInfo.mock.calls
      .map(([record]) => record as Record<string, unknown>)
      .filter(
        (record) =>
          record.event === "subrequest.started" ||
          record.event === "subrequest.completed",
      );
    expect(
      subrequestRecords.map((record) => [record.event, record.model]),
    ).toEqual([
      ["subrequest.started", "model"],
      ["subrequest.completed", "model"],
    ]);
  });

  it("supports Gateway-managed BYOK without local provider keys", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok"));
    vi.spyOn(console, "info").mockImplementation(() => {});

    await handleChatCompletionsRequest(
      createContext(undefined, "openai", 0, [], []),
      new CloudflareAIGateway("account", "gateway", "operator-gateway-token"),
    );

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("falls back to direct provider keys when Gateway keys are absent", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok"));
    vi.spyOn(console, "info").mockImplementation(() => {});

    await handleChatCompletionsRequest(
      createContext(undefined, "openai", 0, API_KEYS, []),
      new CloudflareAIGateway("account", "gateway", "operator-gateway-token"),
    );

    expect(authorizationHeaders(fetchMock)[0]).toBe("Bearer provider-key-0");
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
