import { bench, describe } from "vitest";
import { BUILT_IN_PROVIDER_CONSTRUCTORS } from "~/src/providers";
import { ProviderBase } from "~/src/providers/provider";
import { ProviderRegistry } from "~/src/providers/registry";
import { maskSensitiveUrl } from "~/src/utils/helpers";

const chatBody = JSON.stringify({
  model: "openai/gpt-4o",
  messages: Array.from({ length: 100 }, (_, index) => ({
    role: "user",
    content: `${index}:${"x".repeat(512)}`,
  })),
  temperature: 0.2,
  unsupported: "discarded",
});

const provider = new ProviderBase();
const parsedChatBody = JSON.parse(chatBody) as Record<string, unknown>;
const registry = new ProviderRegistry(BUILT_IN_PROVIDER_CONSTRUCTORS, [
  { name: "internal.v2", baseUrl: "https://internal.example" },
]);
const loggedUrl =
  "https://api.example.com/v1/chat?api_key=sk-1234567890&model=gpt-4o&token=secret123456789";

describe("request hot paths", () => {
  bench("build a chat-completions request", async () => {
    const preparedData = provider.filterSupportedChatParameters(parsedChatBody);
    await provider.buildChatCompletionsRequest({
      body: "",
      preparedData,
      headers: { Accept: "application/json" },
    });
  });

  bench("match a provider route", () => {
    registry.match("/internal.v2/v1/chat/completions?stream=true");
  });

  bench("mask a logged subrequest URL", () => {
    maskSensitiveUrl(loggedUrl);
  });
});
