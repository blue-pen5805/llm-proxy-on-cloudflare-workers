import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getAllProviders,
  getProvider,
  ProviderRegistry,
  Providers,
} from "~/src/providers";
import { CustomOpenAI } from "~/src/providers/custom-openai";
import { OpenAI } from "~/src/providers/openai";
import { Config } from "~/src/utils/config";

describe("provider registry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("constructs registered providers", () => {
    vi.spyOn(Config, "customOpenAIEndpoints").mockReturnValue(undefined);
    expect(getProvider("openai", {} as Env)).toBeInstanceOf(OpenAI);
  });

  it("constructs custom providers by configured name", () => {
    vi.spyOn(Config, "customOpenAIEndpoints").mockReturnValue([
      { name: "internal", baseUrl: "https://internal.example" },
    ]);

    const provider = getProvider("internal", {} as Env);

    expect(provider).toBeInstanceOf(CustomOpenAI);
    expect(provider?.baseUrl()).toBe("https://internal.example");
  });

  it("returns undefined for unknown providers", () => {
    vi.spyOn(Config, "customOpenAIEndpoints").mockReturnValue(undefined);
    expect(getProvider("missing", {} as Env)).toBeUndefined();
  });

  it("returns every built-in and configured custom provider", () => {
    vi.spyOn(Config, "customOpenAIEndpoints").mockReturnValue([
      { name: "internal", baseUrl: "https://internal.example" },
      { name: "backup", baseUrl: "https://backup.example" },
    ]);

    const providers = getAllProviders({} as Env);

    expect(Object.keys(providers)).toEqual([
      ...Object.keys(Providers),
      "internal",
      "backup",
    ]);
    expect(providers.internal).toBeInstanceOf(CustomOpenAI);
    expect(providers.backup).toBeInstanceOf(CustomOpenAI);
  });

  it("works without custom endpoint configuration", () => {
    vi.spyOn(Config, "customOpenAIEndpoints").mockReturnValue(undefined);
    expect(Object.keys(getAllProviders({} as Env))).toEqual(
      Object.keys(Providers),
    );
    expect(new ProviderRegistry(Providers).names()).toEqual(
      Object.keys(Providers),
    );
  });

  it("reuses lazily constructed providers within a registry", () => {
    const registry = new ProviderRegistry(Providers, [
      { name: "internal", baseUrl: "https://internal.example" },
    ]);

    expect(registry.get("openai")).toBe(registry.get("openai"));
    expect(registry.get("internal")).toBe(registry.get("internal"));
    expect(registry.all().openai).toBe(registry.get("openai"));
    expect(registry.all().internal).toBe(registry.get("internal"));
  });

  it("matches provider paths without interpreting names as regular expressions", () => {
    const registry = new ProviderRegistry(Providers, [
      { name: "internal.v2", baseUrl: "https://internal.example" },
    ]);

    expect(registry.match("/internal.v2/v1/models?limit=1")).toEqual({
      providerName: "internal.v2",
      pathname: "/v1/models?limit=1",
    });
    expect(registry.match("/internalXv2/v1/models")).toBeUndefined();
    expect(registry.match("/openai")).toBeUndefined();
  });

  it("preserves existing built-in and listing precedence for name collisions", () => {
    const registry = new ProviderRegistry(Providers, [
      { name: "openai", baseUrl: "https://custom.example" },
    ]);

    expect(registry.get("openai")).toBeInstanceOf(OpenAI);
    expect(registry.all().openai).toBeInstanceOf(CustomOpenAI);
    expect(registry.names().filter((name) => name === "openai")).toHaveLength(
      1,
    );
  });
});
