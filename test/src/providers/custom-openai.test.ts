import { describe, it, expect } from "vitest";
import { CustomOpenAI } from "~/src/providers/custom-openai";
import { buildModelsRequest } from "~/src/providers/models";
import { buildInferenceRequest } from "../../helpers/provider";

describe("CustomOpenAI Provider (Paths)", () => {
  it("should use default paths when not provided in config", async () => {
    const config = {
      name: "test-default",
      baseUrl: "https://example.com",
    };
    const provider = new CustomOpenAI(config);
    expect(provider.endpoints.chat_completions?.path).toBe("/chat/completions");
    expect(provider.endpoints.models?.path).toBe("/models");
    for (const protocol of ["responses", "messages"] as const) {
      expect(provider.endpoints[protocol]).toBeUndefined();
      expect(await provider.resolveInference("model", protocol)).toEqual({
        endpoint: provider.endpoints.chat_completions,
        native: false,
      });
    }
  });

  it("should use custom paths when provided in config", () => {
    const config = {
      name: "test-custom",
      baseUrl: "https://example.com",
      chatCompletionPath: "/v1/chat/completions",
      modelsPath: "/v1/models",
    };
    const provider = new CustomOpenAI(config);
    expect(provider.endpoints.chat_completions?.path).toBe(
      "/v1/chat/completions",
    );
    expect(provider.endpoints.models?.path).toBe("/v1/models");
  });

  it("should build proper request URLs with custom paths", async () => {
    const config = {
      name: "test-url",
      baseUrl: "https://api.example.com",
      chatCompletionPath: "/custom/chat",
      modelsPath: "/custom/models",
    };
    const provider = new CustomOpenAI(config);

    const [chatUrl] = await buildInferenceRequest(provider, {
      data: { messages: [] },
      headers: {},
      target: "direct",
    });
    expect(chatUrl).toBe("https://api.example.com/custom/chat");

    const [modelsUrl] = await buildModelsRequest(
      provider,
      provider.endpoints.models!,
    );
    expect(modelsUrl).toBe("/custom/models");
  });

  it("keeps a configured v1 Base URL unchanged for direct requests", async () => {
    const provider = new CustomOpenAI({
      name: "direct-v1",
      baseUrl: "https://api.example.com/root/v1",
    });

    expect(provider.baseUrl()).toBe("https://api.example.com/root/v1");
    await expect(
      provider.buildRequest(provider.endpoints.models!.path),
    ).resolves.toEqual([
      "https://api.example.com/root/v1/models",
      expect.any(Object),
    ]);
  });

  it.each([
    "http://example.com",
    "https://user:password@example.com",
    "https://example.com?token=secret",
    "not-a-url",
  ])("rejects an unsafe base URL: %s", (baseUrl) => {
    expect(() => new CustomOpenAI({ name: "unsafe", baseUrl })).toThrow(
      /baseUrl/,
    );
  });

  it.each(["", "unsafe name", "x".repeat(129)])(
    "rejects an unsafe endpoint name: %s",
    (name) => {
      expect(
        () => new CustomOpenAI({ name, baseUrl: "https://example.com" }),
      ).toThrow("name is invalid");
    },
  );
});
