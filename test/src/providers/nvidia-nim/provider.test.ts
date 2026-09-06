import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildModelsRequest } from "~/src/providers/models";
import { NvidiaNim } from "~/src/providers/nvidia-nim/provider";
import { Secrets } from "~/src/utils/secrets";
import { buildInferenceRequest } from "../../../helpers/provider";

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
    expect(provider.endpoints.chat_completions?.path).toBe("/chat/completions");
    expect(provider.endpoints.models?.path).toBe("/models");
    expect(provider.available()).toBe(true);
  });

  it("is unavailable without a configured credential", () => {
    vi.mocked(Secrets.getAll).mockReturnValue([]);
    expect(new NvidiaNim().available()).toBe(false);
  });

  it("builds authenticated chat and model requests", async () => {
    const provider = new NvidiaNim();
    const [chatPath, chatInit] = await buildInferenceRequest(provider, {
      data: {
        model: "meta/model",
        messages: [{ role: "user", content: "hello" }],
        temperature: 0.2,
        unsupported: "retained",
      },
      headers: { "X-Request": "kept" },
      target: "direct",
    });
    const [chatUrl, builtChatInit] = [chatPath, chatInit];

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

    const [modelsPath, modelsInit] = await buildModelsRequest(
      provider,
      provider.endpoints.models!,
    );
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

  it("uses the shared OpenAI model-list handling", () => {
    expect(new NvidiaNim().endpoints.models).toEqual({ path: "/models" });
  });
});
