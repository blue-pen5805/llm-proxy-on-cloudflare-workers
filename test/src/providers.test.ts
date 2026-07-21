import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createProviderRegistry,
  getAllProviderInstances,
  getProviderByName,
  ProviderRegistry,
  BUILT_IN_PROVIDER_CONSTRUCTORS,
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
    expect(getProviderByName("openai", {} as Env)).toBeInstanceOf(OpenAI);
  });

  it("constructs custom providers by configured name", () => {
    vi.spyOn(Config, "customOpenAIEndpoints").mockReturnValue([
      { name: "internal", baseUrl: "https://internal.example" },
    ]);

    const provider = getProviderByName("internal", {} as Env);

    expect(provider).toBeInstanceOf(CustomOpenAI);
    expect(provider?.baseUrl()).toBe("https://internal.example");
  });

  it("returns undefined for unknown providers", () => {
    vi.spyOn(Config, "customOpenAIEndpoints").mockReturnValue(undefined);
    expect(getProviderByName("missing", {} as Env)).toBeUndefined();
  });

  it("returns every built-in and configured custom provider", () => {
    vi.spyOn(Config, "customOpenAIEndpoints").mockReturnValue([
      { name: "internal", baseUrl: "https://internal.example" },
      { name: "backup", baseUrl: "https://backup.example" },
    ]);

    const providers = getAllProviderInstances({} as Env);

    expect(Object.keys(providers)).toEqual([
      ...Object.keys(BUILT_IN_PROVIDER_CONSTRUCTORS),
      "internal",
      "backup",
    ]);
    expect(providers.internal).toBeInstanceOf(CustomOpenAI);
    expect(providers.backup).toBeInstanceOf(CustomOpenAI);
  });

  it("works without custom endpoint configuration", () => {
    vi.spyOn(Config, "customOpenAIEndpoints").mockReturnValue(undefined);
    expect(Object.keys(getAllProviderInstances({} as Env))).toEqual(
      Object.keys(BUILT_IN_PROVIDER_CONSTRUCTORS),
    );
    expect(
      new ProviderRegistry(BUILT_IN_PROVIDER_CONSTRUCTORS).names(),
    ).toEqual(Object.keys(BUILT_IN_PROVIDER_CONSTRUCTORS));
  });

  it("reuses lazily constructed providers within a registry", () => {
    const registry = new ProviderRegistry(BUILT_IN_PROVIDER_CONSTRUCTORS, [
      { name: "internal", baseUrl: "https://internal.example" },
    ]);

    expect(registry.get("openai")).toBe(registry.get("openai"));
    expect(registry.get("internal")).toBe(registry.get("internal"));
    expect(registry.all().openai).toBe(registry.get("openai"));
    expect(registry.all().internal).toBe(registry.get("internal"));
  });

  it("matches provider paths without interpreting names as regular expressions", () => {
    const registry = new ProviderRegistry(BUILT_IN_PROVIDER_CONSTRUCTORS, [
      { name: "internal.v2", baseUrl: "https://internal.example" },
    ]);

    expect(registry.match("/internal.v2/v1/models?limit=1")).toEqual({
      providerName: "internal.v2",
      pathname: "/v1/models?limit=1",
    });
    expect(registry.match("/internalXv2/v1/models")).toBeUndefined();
    expect(registry.match("/openai")).toBeUndefined();
    expect(registry.match("openai/v1/models")).toBeUndefined();
  });

  it("resolves and enumerates named credential profiles", () => {
    const registry = new ProviderRegistry(BUILT_IN_PROVIDER_CONSTRUCTORS, [
      {
        name: "internal",
        baseUrl: "https://internal.example",
        apiKeys: {
          default: ["default-key"],
          paid: ["paid-one", "paid-two"],
        },
      },
    ]);

    expect(registry.get("internal")?.getApiKeys()).toEqual(["default-key"]);
    expect(registry.get("internal:default")).toBe(registry.get("internal"));
    expect(registry.get("internal:paid")?.getApiKeys()).toEqual([
      "paid-one",
      "paid-two",
    ]);
    expect(registry.get("internal:missing")).toBeUndefined();
    expect(registry.get("internal:bad/profile")).toBeUndefined();
    expect(registry.match("/internal:paid/v1/models")).toEqual({
      providerName: "internal:paid",
      pathname: "/v1/models",
    });
    expect(Object.keys(registry.all())).toContain("internal:paid");
  });

  it("reuses registries across requests with an unchanged configuration", () => {
    const withoutEndpoints = vi
      .spyOn(Config, "customOpenAIEndpoints")
      .mockReturnValue(undefined);
    expect(createProviderRegistry({} as Env)).toBe(
      createProviderRegistry({} as Env),
    );
    withoutEndpoints.mockRestore();

    const endpoints = [
      { name: "internal", baseUrl: "https://internal.example" },
    ];
    vi.spyOn(Config, "customOpenAIEndpoints").mockReturnValue(endpoints);
    const registry = createProviderRegistry({} as Env);
    expect(registry).toBe(createProviderRegistry({} as Env));
    expect(registry.get("internal")).toBeInstanceOf(CustomOpenAI);
  });

  it("rejects custom endpoint names that collide with built-ins", () => {
    expect(
      () =>
        new ProviderRegistry(BUILT_IN_PROVIDER_CONSTRUCTORS, [
          { name: "openai", baseUrl: "https://custom.example" },
        ]),
    ).toThrow("duplicated or reserved");
  });

  it("rejects duplicate custom endpoint names", () => {
    expect(
      () =>
        new ProviderRegistry(BUILT_IN_PROVIDER_CONSTRUCTORS, [
          { name: "duplicate", baseUrl: "https://first.example" },
          { name: "duplicate", baseUrl: "https://last.example" },
        ]),
    ).toThrow("duplicated or reserved");
  });

  it("keeps the explicit built-in name catalog synchronized", async () => {
    const { BUILT_IN_PROVIDER_NAMES } = await import("~/src/providers/names");
    expect([...BUILT_IN_PROVIDER_NAMES].sort()).toEqual(
      Object.keys(BUILT_IN_PROVIDER_CONSTRUCTORS).sort(),
    );
  });
});
