import { afterEach, describe, expect, it, vi } from "vitest";
import { getAllProviders, getProvider, Providers } from "~/src/providers";
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
  });
});
