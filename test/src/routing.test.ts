import { describe, expect, it, vi } from "vitest";
import { CloudflareAIGateway } from "~/src/ai_gateway";
import { handleChatCompletionsRequest } from "~/src/requests/chat_completions";
import { handleCompatibilityRequest } from "~/src/requests/compat";
import { handleMessagesRequest } from "~/src/requests/messages";
import { handleProviderProxyRequest } from "~/src/requests/proxy";
import { handleResponsesRequest } from "~/src/requests/responses";
import { handleUniversalEndpointRequest } from "~/src/requests/universal_endpoint";
import { handleRouting } from "../helpers/hono";
import { createTestRoutedContext } from "../helpers/request_context";

vi.mock("~/src/requests/chat_completions", () => ({
  handleChatCompletionsRequest: vi.fn(() => new Response("chat")),
}));
vi.mock("~/src/requests/responses", () => ({
  handleResponsesRequest: vi.fn(() => new Response("responses")),
}));
vi.mock("~/src/requests/messages", () => ({
  handleMessagesRequest: vi.fn(() => new Response("messages")),
}));
vi.mock("~/src/requests/compat", () => ({
  handleCompatibilityRequest: vi.fn(() => new Response("compat")),
}));
vi.mock("~/src/requests/universal_endpoint", () => ({
  handleUniversalEndpointRequest: vi.fn(() => new Response("universal")),
}));
vi.mock("~/src/requests/proxy", () => ({
  handleProviderProxyRequest: vi.fn(() => new Response("proxy")),
}));

describe("Hono routing", () => {
  it.each([
    [
      "/v1/chat/completions?trace=true",
      false,
      "chat",
      handleChatCompletionsRequest,
    ],
    [
      "/chat/completions?trace=true",
      false,
      "chat",
      handleChatCompletionsRequest,
    ],
    ["/v1/chat/completions", true, "chat", handleChatCompletionsRequest],
    ["/chat/completions", true, "chat", handleChatCompletionsRequest],
    ["/v1/responses?trace=true", false, "responses", handleResponsesRequest],
    ["/v1/messages?trace=true", false, "messages", handleMessagesRequest],
    [
      "/compat/chat/completions?trace=true",
      true,
      "compat",
      handleCompatibilityRequest,
    ],
    ["/?trace=true", true, "universal", handleUniversalEndpointRequest],
  ] as const)(
    "matches %s without querying provider routes",
    async (pathname, hasAiGateway, body, handler) => {
      vi.clearAllMocks();
      const context = createTestRoutedContext({
        request: new Request(`https://example.com${pathname}`, {
          method: "POST",
        }),
        pathname,
      });
      const match = vi.spyOn(context.providers, "match");
      const response = await handleRouting(
        context,
        hasAiGateway
          ? new CloudflareAIGateway("account", "gateway")
          : undefined,
      );
      expect(await response.text()).toBe(body);
      expect(handler).toHaveBeenCalledOnce();
      expect(match).not.toHaveBeenCalled();
    },
  );

  it("passes the original request and exact query suffix to the provider handler", async () => {
    const context = createTestRoutedContext({
      request: new Request("https://example.com/openai/v1/models?limit=2"),
      pathname: "/openai/v1/models?limit=2",
    });
    const response = await handleRouting(context);
    expect(await response.text()).toBe("proxy");
    expect(handleProviderProxyRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({ request: context.request }),
      "openai",
      "/v1/models?limit=2",
      undefined,
    );
  });
});
