import { describe, expect, it } from "vitest";
import {
  customProviderRoute,
  customProviderSlug,
  gatewayProviderPath,
  resolveGatewayProvider,
} from "~/src/ai_gateway/custom_provider";
import { Ollama } from "~/src/providers/ollama/provider";

describe("AI Gateway Custom Provider routing", () => {
  it("uses the requested managed slug form for simple provider names", () => {
    expect(customProviderSlug("ollama")).toBe("llm-proxy-ollama");
    expect(customProviderRoute("ollama")).toBe("custom-llm-proxy-ollama");
  });

  it("produces deterministic distinct slugs for names requiring normalization", () => {
    expect(customProviderSlug("Internal.V2")).toMatch(
      /^llm-proxy-internal-v2-[a-f0-9]{8}$/,
    );
    expect(customProviderSlug("Internal.V2")).not.toBe(
      customProviderSlug("internal-v2"),
    );
    expect(customProviderSlug("!!!")).toMatch(
      /^llm-proxy-provider-[a-f0-9]{8}$/,
    );
  });

  it("uses Custom Providers only when strict mode has no native route", () => {
    const strictGateway = { alwaysUse: true } as never;
    expect(resolveGatewayProvider("ollama", strictGateway, false)).toBe(
      "custom-llm-proxy-ollama",
    );
    expect(resolveGatewayProvider("openai", strictGateway, true)).toBe(
      "openai",
    );
    expect(
      resolveGatewayProvider("ollama", { alwaysUse: false } as never, false),
    ).toBeUndefined();
    expect(resolveGatewayProvider("openai", undefined)).toBeUndefined();
    expect(resolveGatewayProvider("openai", strictGateway)).toBe("openai");
  });

  it("retains fixed provider prefixes only for Custom Provider routes", () => {
    const provider = {
      aiGatewayPath: (path: string) => `/native${path}`,
      pathnamePrefix: () => "/v1",
    };
    expect(gatewayProviderPath("openai", provider, "/models", "openai")).toBe(
      "/native/models",
    );
    expect(
      gatewayProviderPath(
        "ollama",
        provider,
        "/models",
        "custom-llm-proxy-ollama",
      ),
    ).toBe("/v1/models");
  });

  it("retains Ollama's v1 prefix for its Custom Provider route", () => {
    const provider = new Ollama();
    expect(
      gatewayProviderPath(
        "ollama",
        provider,
        provider.chatCompletionPath,
        customProviderRoute("ollama"),
      ),
    ).toBe("/v1/chat/completions");
  });
});
