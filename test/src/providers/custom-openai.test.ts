import { describe, it, expect } from "vitest";
import { CustomOpenAI } from "~/src/providers/custom-openai";

describe("CustomOpenAI Provider (Paths)", () => {
  it("should use default paths when not provided in config", () => {
    const config = {
      name: "test-default",
      baseUrl: "https://example.com",
    };
    const provider = new CustomOpenAI(config);
    expect(provider.chatCompletionPath).toBe("/chat/completions");
    expect(provider.modelsPath).toBe("/models");
  });

  it("should use custom paths when provided in config", () => {
    const config = {
      name: "test-custom",
      baseUrl: "https://example.com",
      chatCompletionPath: "/v1/chat/completions",
      modelsPath: "/v1/models",
    };
    const provider = new CustomOpenAI(config);
    expect(provider.chatCompletionPath).toBe("/v1/chat/completions");
    expect(provider.modelsPath).toBe("/v1/models");
  });

  it("should build proper request URLs with custom paths", async () => {
    const config = {
      name: "test-url",
      baseUrl: "https://api.example.com",
      chatCompletionPath: "/custom/chat",
      modelsPath: "/custom/models",
    };
    const provider = new CustomOpenAI(config);

    const [chatUrl] = await provider.buildChatCompletionsRequest({
      body: JSON.stringify({ messages: [] }),
      headers: {},
    });
    expect(chatUrl).toBe("/custom/chat");

    const [modelsUrl] = await provider.buildModelsRequest();
    expect(modelsUrl).toBe("/custom/models");
  });
});
