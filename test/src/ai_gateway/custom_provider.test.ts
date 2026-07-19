import { describe, expect, it } from "vitest";
import {
  customProviderBaseUrl,
  customProviderRoute,
  customProviderSlug,
  gatewayProviderPath,
  resolveGatewayProvider,
} from "~/src/ai_gateway/custom_provider";
import { Cline } from "~/src/providers/cline/provider";
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
      baseUrl: () => "https://api.example.test",
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
    expect(customProviderBaseUrl(provider)).toBe("https://ollama.com/v1");
    expect(
      gatewayProviderPath(
        "ollama",
        provider,
        provider.chatCompletionPath,
        customProviderRoute("ollama"),
      ),
    ).toBe("/v1/chat/completions");
  });

  it("retains Cline's trailing v1 and repeats it in request paths", () => {
    const provider = new Cline();
    const gatewayPath = gatewayProviderPath(
      "cline",
      provider,
      provider.modelsPath,
      customProviderRoute("cline"),
    );

    expect(customProviderBaseUrl(provider)).toBe(
      "https://api.cline.bot/api/v1",
    );
    expect(gatewayPath).toBe("/v1/ai/cline/recommended-models");
  });

  it("supports any trailing version-like segment", () => {
    const provider = {
      aiGatewayPath: (path: string) => path,
      baseUrl: () => "https://internal.example/fixed/vABCDE//",
      pathnamePrefix: () => "/openai",
    };

    expect(customProviderBaseUrl(provider)).toBe(
      "https://internal.example/fixed/vABCDE",
    );
    expect(
      gatewayProviderPath(
        "internal",
        provider,
        "/models",
        customProviderRoute("internal"),
      ),
    ).toBe("/vABCDE/openai/models");
  });

  it("adds a consumed v1 sentinel for an unversioned Base URL", () => {
    const provider = {
      aiGatewayPath: (path: string) => path,
      baseUrl: () => "https://internal.example/fixed//",
      pathnamePrefix: () => "/openai",
    };

    expect(customProviderBaseUrl(provider)).toBe(
      "https://internal.example/fixed/v1",
    );
    expect(
      gatewayProviderPath(
        "internal",
        provider,
        "/models",
        customProviderRoute("internal"),
      ),
    ).toBe("/openai/models");
  });
});
