import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NvidiaNim } from "~/src/providers/nvidia-nim/provider";
import { Secrets } from "~/src/utils/secrets";

describe("NVIDIA NIM provider", () => {
  beforeEach(() => {
    vi.spyOn(Secrets, "getAll").mockImplementation((name) =>
      name === "NVIDIA_NIM_API_KEY" ? ["nim-key"] : [],
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("declares its hosted API endpoint and credential", () => {
    const provider = new NvidiaNim();

    expect(provider.apiKeyName).toBe("NVIDIA_NIM_API_KEY");
    expect(provider.baseUrl()).toBe("https://integrate.api.nvidia.com");
    expect(provider.pathnamePrefix()).toBe("/v1");
    expect(provider.chatCompletionPath).toBe("/chat/completions");
    expect(provider.modelsPath).toBe("/models");
    expect(provider.available()).toBe(true);
  });

  it("is unavailable without a configured credential", () => {
    vi.mocked(Secrets.getAll).mockReturnValue([]);
    expect(new NvidiaNim().available()).toBe(false);
  });

  it("builds authenticated chat and model requests", async () => {
    const provider = new NvidiaNim();
    const [chatPath, chatInit] = await provider.buildChatCompletionsRequest({
      body: JSON.stringify({
        model: "meta/model",
        messages: [{ role: "user", content: "hello" }],
        temperature: 0.2,
        unsupported: "retained",
      }),
      headers: { "X-Request": "kept" },
    });
    const [chatUrl, builtChatInit] = await provider.buildRequest(
      chatPath,
      chatInit,
    );

    expect(chatUrl).toBe(
      "https://integrate.api.nvidia.com/v1/chat/completions",
    );
    expect(JSON.parse(String(builtChatInit.body))).toEqual({
      model: "meta/model",
      messages: [{ role: "user", content: "hello" }],
      temperature: 0.2,
      unsupported: "retained",
    });
    expect(new Headers(builtChatInit.headers)).toEqual(
      new Headers({
        Authorization: "Bearer nim-key",
        "Content-Type": "application/json",
        "X-Request": "kept",
      }),
    );

    const [modelsPath, modelsInit] = await provider.buildModelsRequest();
    const [modelsUrl, builtModelsInit] = await provider.buildRequest(
      modelsPath,
      modelsInit,
    );
    expect(modelsUrl).toBe("https://integrate.api.nvidia.com/v1/models");
    expect(builtModelsInit.method).toBe("GET");
    expect(new Headers(builtModelsInit.headers)).toEqual(
      new Headers({
        Authorization: "Bearer nim-key",
        "Content-Type": "application/json",
      }),
    );
  });

  it("preserves OpenAI-compatible model-list responses", () => {
    const response = {
      object: "list" as const,
      data: [
        {
          id: "meta/model",
          object: "model" as const,
          created: 0,
          owned_by: "nvidia",
        },
      ],
    };

    expect(new NvidiaNim().convertModelsToOpenAIFormat(response)).toBe(
      response,
    );
  });
});
