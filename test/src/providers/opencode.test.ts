import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createProviderRegistry } from "~/src/providers";
import { OpenCodeGo, OpenCodeZen } from "~/src/providers/opencode";
import { withProviderProfile } from "~/src/providers/provider";
import { Environments } from "~/src/utils/environments";
import {
  opencodeCatalog,
  opencodeCatalogUrl,
  opencodeChatRequest,
} from "../../helpers/opencode";

describe("OpenCode provider resolution", () => {
  beforeEach(async () => {
    // These protocol fixtures exercise origin responses independently of cache state.
    const cache = await caches.open("llm-proxy-opencode-protocol-v1");
    vi.spyOn(cache, "match").mockResolvedValue(undefined);
    vi.spyOn(cache, "put").mockResolvedValue(undefined);
    vi.spyOn(caches, "open").mockResolvedValue(cache);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("registers both providers and shares credential profiles and selected slots", async () => {
    await Environments.runWithConfig(
      {
        OPENCODE_API_KEY: {
          default: ["example-a", "example-b"],
          paid: "example-paid",
        },
      },
      async () => {
        const registry = createProviderRegistry(Environments.all());
        for (const name of ["opencode-zen", "opencode-go"]) {
          const provider = registry.get(name)!;
          expect(provider.available()).toBe(true);
          expect(provider.apiKeyName).toBe("OPENCODE_API_KEY");
          expect(provider.getApiKeys()).toEqual(["example-a", "example-b"]);
          expect(provider.getCredentialProfiles()).toEqual(["default", "paid"]);
          expect(
            new Headers(await provider.headers(1)).get("authorization"),
          ).toBe("Bearer example-b");
          const paid = withProviderProfile(provider, "paid");
          expect(new Headers(await paid.headers()).get("authorization")).toBe(
            "Bearer example-paid",
          );
        }
      },
    );
    await Environments.runWithConfig({}, async () => {
      for (const provider of [new OpenCodeZen(), new OpenCodeGo()]) {
        expect(provider.available()).toBe(false);
        expect(
          new Headers(await provider.buildHeadersForPath("/messages")).has(
            "x-api-key",
          ),
        ).toBe(false);
        expect(
          new Headers(
            await provider.buildHeadersForPath(
              "/models/google:generateContent",
            ),
          ).has("x-goog-api-key"),
        ).toBe(false);
      }
    });
  });

  it("fetches credential-free catalogs on cache misses and inherits the top-level SDK", async () => {
    const catalog = opencodeCatalog();
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json(catalog));
    const provider = new OpenCodeZen();
    expect(
      (await provider.resolveInference("inherited", "chat_completions"))
        ?.native,
    ).toBe(true);
    catalog.opencode.models.inherited.provider = {
      npm: "@ai-sdk/openai",
    };
    fetch.mockResolvedValueOnce(Response.json(catalog));
    expect(
      (await provider.resolveInference("inherited", "responses"))?.native,
    ).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetch.mock.calls) {
      expect(url).toBe(opencodeCatalogUrl);
      expect(new Headers(init?.headers)).toEqual(
        new Headers({ accept: "application/json" }),
      );
      expect(init?.redirect).toBe("manual");
      expect(init?.cache).toBe("no-store");
      expect(init?.body).toBeUndefined();
    }
  });

  it("uses Go's independent SDK overrides", async () => {
    const catalog = opencodeCatalog();
    catalog["opencode-go"].models.chat = {
      provider: { npm: "@ai-sdk/anthropic" },
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json(catalog),
    );
    expect(
      (await new OpenCodeGo().resolveInference("chat", "messages"))?.native,
    ).toBe(true);
    expect(
      (await new OpenCodeZen().resolveInference("chat", "messages"))?.native,
    ).toBe(false);
  });

  it.each(["chat_completions", "responses", "messages"] as const)(
    "resolves all SDK families for public %s",
    async (protocol) => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
        Response.json(opencodeCatalog()),
      );
      for (const [model, nativeProtocol, path] of [
        ["chat", "chat_completions", "/chat/completions"],
        ["responses", "responses", "/responses"],
        ["messages", "messages", "/messages"],
        ["google", "generateContent", "/models/google:generateContent"],
      ]) {
        const provider = new OpenCodeZen();
        const resolved = (await provider.resolveInference(model, protocol))!;
        expect(resolved.native).toBe(protocol === nativeProtocol);
        const [url] = await resolved.endpoint.buildRequest.call(provider, {
          data: { model, ...opencodeChatRequest },
          headers: {},
          target: "direct",
        });
        expect(url).toBe(`https://opencode.ai/zen/v1${path}`);
      }
    },
  );

  it.each([
    null,
    [],
    {},
    { opencode: null },
    { opencode: { models: [] } },
    { opencode: { models: { model: null } } },
    { opencode: { models: { model: { provider: null } } } },
    { opencode: { models: { model: { provider: "invalid" } } } },
    { opencode: { models: { model: {} } } },
    { opencode: { npm: 42, models: { model: {} } } },
    { opencode: { npm: "constructor", models: { model: {} } } },
    { opencode: { npm: "@ai-sdk/future", models: { model: {} } } },
  ])("rejects malformed or unsupported catalog data: %j", async (catalog) => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json(catalog));
    await expect(
      new OpenCodeZen().resolveInference("model", "responses"),
    ).rejects.toMatchObject({
      status: 502,
      message: "OpenCode protocol catalog is unavailable or invalid.",
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(["missing", "constructor", "__proto__", "toString"])(
    "rejects a missing or inherited model %s",
    async (model) => {
      const fetch = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(Response.json(opencodeCatalog()));
      await expect(
        new OpenCodeZen().resolveInference(model, "responses"),
      ).rejects.toMatchObject({ status: 400 });
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it.each([302, 429, 500])(
    "releases catalog HTTP %s bodies without following redirects",
    async (status) => {
      const response = new Response("untrusted", {
        status,
        headers: { location: "https://untrusted.example" },
      });
      const cancel = vi.spyOn(response.body!, "cancel");
      const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
      await expect(
        new OpenCodeZen().resolveInference("chat", "responses"),
      ).rejects.toMatchObject({ status: 502 });
      expect(cancel).toHaveBeenCalledOnce();
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it("handles empty errors, failed cancellation, malformed JSON and oversized catalogs", async () => {
    const failedCancellation = new Response("bad", { status: 500 });
    vi.spyOn(failedCancellation.body!, "cancel").mockRejectedValue(
      new Error("cannot cancel"),
    );
    const fetch = vi.spyOn(globalThis, "fetch");
    for (const response of [
      new Response(null, { status: 500 }),
      failedCancellation,
      new Response("{"),
      new Response("x", {
        headers: { "content-length": String(8 * 1024 * 1024 + 1) },
      }),
      new Response('"' + "x".repeat(8 * 1024 * 1024) + '"'),
    ]) {
      fetch.mockResolvedValueOnce(response);
      await expect(
        new OpenCodeZen().resolveInference("chat", "responses"),
      ).rejects.toMatchObject({ status: 502 });
    }
  });

  it("bounds catalog fetch and body reads to five seconds", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => new Promise(() => {}));
    const pending = expect(
      new OpenCodeZen().resolveInference("chat", "responses"),
    ).rejects.toMatchObject({ status: 502 });
    await vi.advanceTimersByTimeAsync(5_000);
    await pending;
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
    fetch.mockResolvedValueOnce(
      new Response(new ReadableStream({ start() {} })),
    );
    const bodyPending = expect(
      new OpenCodeZen().resolveInference("chat", "responses"),
    ).rejects.toMatchObject({ status: 502 });
    await vi.advanceTimersByTimeAsync(5_000);
    await bodyPending;
  });

  it("propagates cancellation and hides network errors", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("upstream private detail"));
    await expect(
      new OpenCodeZen().resolveInference("chat", "responses"),
    ).rejects.toMatchObject({ status: 502 });
    const controller = new AbortController();
    fetch.mockImplementation(async (_url, init) => {
      controller.abort();
      init?.signal?.throwIfAborted();
      throw new Error("unreachable");
    });
    await expect(
      new OpenCodeZen().resolveInference(
        "chat",
        "responses",
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    fetch.mockClear();
    await expect(
      new OpenCodeZen().resolveInference(
        "chat",
        "responses",
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
