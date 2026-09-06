import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenCodeGo, OpenCodeZen } from "~/src/providers/opencode";
import { RequestLogger } from "~/src/utils/logger";
import { opencodeCatalog, opencodeCatalogUrl } from "../../helpers/opencode";

const cacheName = "llm-proxy-opencode-protocol-v1";

describe("OpenCode protocol catalog cache", () => {
  let cache: Cache;
  beforeEach(async () => {
    cache = await caches.open(cacheName);
    await cache.delete(opencodeCatalogUrl);
    vi.spyOn(caches, "open").mockResolvedValue(cache);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    await cache.delete(opencodeCatalogUrl);
  });

  it("shares a five-minute public catalog between Zen and Go and refreshes after eviction", async () => {
    const catalog = opencodeCatalog();
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({
        ...catalog,
        unrelated: { models: { irrelevant: {} } },
      }),
    );
    const zen = new OpenCodeZen();
    expect(
      (await zen.resolveInference("chat", "chat_completions"))?.native,
    ).toBe(true);
    const stored = (await cache.match(opencodeCatalogUrl))!;
    expect(stored.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await stored.json()).toEqual(catalog);
    expect(
      (await new OpenCodeGo().resolveInference("responses", "responses"))
        ?.native,
    ).toBe(true);
    expect(
      (await new OpenCodeZen().resolveInference("messages", "messages"))
        ?.native,
    ).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    await cache.delete(opencodeCatalogUrl);
    catalog.opencode.models.chat = {
      provider: { npm: "@ai-sdk/openai" },
    } as typeof catalog.opencode.models.chat;
    fetch.mockResolvedValueOnce(Response.json(catalog));
    expect((await zen.resolveInference("chat", "responses"))?.native).toBe(
      true,
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(["open", "match", "put"] as const)(
    "survives cache %s failures without logging their content",
    async (operation) => {
      const error = new Error("sensitive cache details");
      if (operation === "open") vi.mocked(caches.open).mockRejectedValue(error);
      else vi.spyOn(cache, operation).mockRejectedValue(error);
      const warn = vi.spyOn(RequestLogger, "warn");
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        Response.json(opencodeCatalog()),
      );
      expect(
        (await new OpenCodeZen().resolveInference("chat", "chat_completions"))
          ?.native,
      ).toBe(true);
      expect(warn).toHaveBeenCalledWith(
        "opencode.catalog.cache.unavailable",
        "OpenCode catalog cache unavailable; continuing without it",
        { operation: operation === "put" ? "write" : "read" },
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain(error.message);
    },
  );

  it.each(["invalid JSON", "null", '{"opencode":{}}'])(
    "refetches malformed cached metadata: %s",
    async (body) => {
      vi.spyOn(cache, "match").mockResolvedValue(new Response(body));
      const fetch = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(Response.json(opencodeCatalog()));
      expect(
        (await new OpenCodeZen().resolveInference("chat", "chat_completions"))
          ?.native,
      ).toBe(true);
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it("refreshes a cached catalog when a requested model is absent", async () => {
    const catalog = opencodeCatalog();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json(catalog),
    );
    const zen = new OpenCodeZen();
    await zen.resolveInference("chat", "chat_completions");
    catalog.opencode.models = {
      ...catalog.opencode.models,
      added: {},
    } as typeof catalog.opencode.models;
    expect(
      (await zen.resolveInference("added", "chat_completions"))?.native,
    ).toBe(true);
    await expect(
      zen.resolveInference("missing", "responses"),
    ).rejects.toMatchObject({ status: 400 });
  });

  it.each([
    Response.json(null),
    Response.json({ opencode: {} }),
    new Response("upstream failure", { status: 503 }),
  ])("does not store invalid origin responses", async (response) => {
    const put = vi.spyOn(cache, "put");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
    await expect(
      new OpenCodeZen().resolveInference("chat", "responses"),
    ).rejects.toMatchObject({ status: 502 });
    expect(put).not.toHaveBeenCalled();
  });

  it("bounds cache reads and prevents late origin fetches after the deadline", async () => {
    vi.useFakeTimers();
    let release!: (value: Response | undefined) => void;
    vi.spyOn(cache, "match").mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const fetch = vi.spyOn(globalThis, "fetch");
    const pending = expect(
      new OpenCodeZen().resolveInference("chat", "responses"),
    ).rejects.toMatchObject({ status: 502 });
    await vi.advanceTimersByTimeAsync(5_000);
    await pending;
    release(undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("honors client cancellation while reading a cache hit", async () => {
    const controller = new AbortController();
    vi.spyOn(cache, "match").mockImplementation(async () => {
      controller.abort();
      return Response.json(opencodeCatalog());
    });
    const fetch = vi.spyOn(globalThis, "fetch");
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
