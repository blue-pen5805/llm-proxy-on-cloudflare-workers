import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudflareAIGateway } from "~/src/ai_gateway";
import { handleChatCompletionsRequest } from "~/src/requests/chat_completions";
import { Environments } from "~/src/utils/environments";
import { createTestRoutedContext } from "../../helpers/request_context";

describe("inference cancellation", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([false, true])(
    "stops nested virtual-model retries after client cancellation (Gateway %s)",
    async (viaGateway) => {
      const controller = new AbortController();
      const reason = new Error("client disconnected");
      const fetch = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async () => {
          controller.abort(reason);
          throw reason;
        });
      const context = createTestRoutedContext({
        request: new Request("https://proxy.example/v1/chat/completions", {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({ model: "virtual/main", messages: [] }),
        }),
      });
      const select = vi
        .spyOn(context.providers.get("openai")!, "getNextApiKeyIndex")
        .mockResolvedValue(0);
      const env = {
        ...context.env,
        OPENAI_API_KEY: '["test-provider-key-0","test-provider-key-1"]',
        VIRTUAL_MODELS: JSON.stringify({
          "virtual/main": ["virtual/nested", "openai/last"],
          "virtual/nested": [
            { model: "openai/first", retries: 2 },
            "openai/second",
          ],
        }),
      };
      await expect(
        Environments.run(env, () =>
          handleChatCompletionsRequest(
            context,
            viaGateway
              ? new CloudflareAIGateway("account", "gateway")
              : undefined,
          ),
        ),
      ).rejects.toBe(reason);
      expect(fetch).toHaveBeenCalledOnce();
      expect(select).toHaveBeenCalledOnce();
    },
  );
});
