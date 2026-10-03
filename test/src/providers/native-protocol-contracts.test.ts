import { describe, expect, it, vi } from "vitest";
import { BUILT_IN_PROVIDER_CONSTRUCTORS } from "~/src/providers";
import { CustomOpenAI } from "~/src/providers/custom-openai";
import { chatCompletionsEndpoint } from "~/src/providers/inference";
import { createProvider } from "~/src/providers/provider";

describe("explicit native Chat declarations", () => {
  it.each([
    "openai",
    "anthropic",
    "groq",
    "grok",
    "openrouter",
    "ollama",
    "cerebras",
    "cline",
    "cohere",
    "deepseek",
    "mistral",
    "nvidia-nim",
    "azure-openai",
    "perplexity-ai",
    "workers-ai",
    "google-ai-studio",
    "google-vertex-ai",
    "huggingface",
  ])(
    "declares Chat support for %s independently of conversion defaults",
    async (name) => {
      const provider = new BUILT_IN_PROVIDER_CONSTRUCTORS[name]!();
      expect(
        (await provider.resolveInference("model", "chat_completions"))?.native,
      ).toBe(true);
    },
  );

  it.each(["replicate"])(
    "does not invent Chat support for %s",
    async (name) => {
      const provider = new BUILT_IN_PROVIDER_CONSTRUCTORS[name]!();
      expect(
        (await provider.resolveInference("model", "chat_completions"))?.native,
      ).not.toBe(true);
    },
  );

  it("keeps Bedrock native Chat model-specific", async () => {
    const provider = new BUILT_IN_PROVIDER_CONSTRUCTORS["aws-bedrock"]!();
    for (const model of [
      "openai.gpt-oss-20b-1:0",
      "us.openai.gpt-oss-120b-1:0",
    ]) {
      expect(
        (await provider.resolveInference(model, "chat_completions"))?.native,
      ).toBe(true);
      expect(
        (await provider.resolveInference(model, "responses"))?.native,
      ).toBe(true);
    }
    expect(
      (await provider.resolveInference("amazon.nova", "chat_completions"))
        ?.native,
    ).toBe(false);
  });

  it("declares custom OpenAI Chat without implying Responses support", async () => {
    const provider = new CustomOpenAI({
      name: "example",
      baseUrl: "https://example.test",
      apiKeys: ["example-key"],
    });
    expect(
      (await provider.resolveInference("model", "chat_completions"))?.native,
    ).toBe(true);
    expect(
      (await provider.resolveInference("model", "responses"))?.native,
    ).toBe(false);
  });

  it.each(["chat_completions", "responses", "messages"] as const)(
    "selects a matching %s operation without resolving a conversion fallback",
    async (protocol) => {
      const endpoint = chatCompletionsEndpoint("/matching");
      const fallback = chatCompletionsEndpoint("/fallback");
      const resolveChatFallback = vi.fn(() => fallback);
      const provider = createProvider({
        endpoints: { [protocol]: endpoint },
        chatFallback: fallback,
        resolveChatFallback,
      });
      expect(await provider.resolveInference("model", protocol)).toEqual({
        endpoint,
        native: true,
      });
      expect(resolveChatFallback).not.toHaveBeenCalled();
    },
  );

  it("does not expose another origin's Chat path as a Universal Endpoint default", async () => {
    const upstream = {
      name: "example/inference",
      baseUrl: () => "https://inference.example",
    };
    const endpoint = chatCompletionsEndpoint("/chat/completions", { upstream });
    const provider = createProvider({
      baseUrl: "https://passthrough.example",
      endpoints: { chat_completions: endpoint },
    });
    expect(endpoint.path).toBeUndefined();
    expect(endpoint.upstream).toBe(upstream);
    const [url] = await endpoint.buildRequest.call(provider, {
      data: { model: "model", messages: [] },
      headers: {},
      target: "direct",
    });
    expect(url).toBe("https://inference.example/chat/completions");
  });

  it("keeps Chat filtering and response hooks on the selected operation", async () => {
    const upstream = new Response("upstream");
    const rewritten = new Response("rewritten");
    const transformResponse = vi.fn(async () => rewritten);
    const operation = chatCompletionsEndpoint("/custom/chat", {
      supportedParameters: ["model", "messages"],
      transformResponse,
    });
    const provider = createProvider({
      baseUrl: "https://example.test",
      endpoints: { chat_completions: operation },
    });
    const data = { model: "model", messages: [], temperature: 0.5 };
    for (const target of ["direct", "gateway"] as const) {
      const [url, init] = await operation.buildRequest.call(provider, {
        data,
        headers: {},
        target,
      });
      expect(url).toBe(
        target === "direct"
          ? "https://example.test/custom/chat"
          : "/custom/chat",
      );
      expect(JSON.parse(String(init.body))).toEqual({
        model: "model",
        messages: [],
      });
    }
    expect(
      await operation.transformResponse!.call(
        provider,
        upstream,
        "model",
        data,
      ),
    ).toBe(rewritten);
    expect(transformResponse).toHaveBeenCalledWith(upstream, "model", data);
  });
});
