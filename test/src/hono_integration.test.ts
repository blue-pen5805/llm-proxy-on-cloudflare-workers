import { createExecutionContext } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import app from "~/src/index";
import { Config } from "~/src/utils/config";

// Deliberately fake bindings: these tests never contact a provider.
const bindings = {
  PROXY_API_KEY: "example-proxy-key",
  OPENAI_API_KEY: '["example-provider-zero","example-provider-one"]',
} as Env;
const authorization = { Authorization: "Bearer example-proxy-key" };

function request(path: string, init: RequestInit = {}, env = bindings) {
  return app.request(
    path,
    {
      ...init,
      headers: { ...authorization, ...init.headers },
    },
    env,
    createExecutionContext(),
  );
}

afterEach(() => vi.restoreAllMocks());

describe("Hono request lifecycle", () => {
  it("preserves request and response streams and forwards cancellation through both routing stages", async () => {
    const incoming = new ReadableStream<Uint8Array>();
    const cancelled = vi.fn();
    const outgoing = new ReadableStream<Uint8Array>({ cancel: cancelled });
    const upstream = new Response(outgoing, {
      headers: { "Content-Type": "text/event-stream" },
    });
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(upstream);
    const abort = new AbortController();
    const raw = new Request(
      "https://proxy.example/key/1/openai/chat/completions?region=a%2Fb&region=c&empty=",
      {
        method: "POST",
        headers: authorization,
        body: incoming,
        signal: abort.signal,
      },
    );
    const response = await app.fetch(raw, bindings, createExecutionContext());
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(
      "https://api.openai.com/v1/chat/completions?region=a%2Fb&region=c&empty=",
    );
    expect(init?.body).toBe(raw.body);
    expect(raw.bodyUsed).toBe(false);
    expect(response.body).toBe(outgoing);
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer example-provider-one",
    );
    abort.abort();
    expect(init?.signal?.aborted).toBe(true);
    await response.body!.cancel("client disconnected");
    expect(cancelled).toHaveBeenCalledWith("client disconnected");
    await incoming.cancel();
  });

  it.each(["https://allowed.example", "https://denied.example"])(
    "replaces upstream CORS policy for %s without modifying the upstream response",
    async (origin) => {
      const upstream = new Response("upstream", {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Expose-Headers": "X-Upstream-Private",
          Vary: "Accept-Encoding",
        },
      });
      vi.spyOn(globalThis, "fetch").mockResolvedValue(upstream);
      const response = await request(
        "/openai/v1/models",
        { headers: { Origin: origin } },
        {
          ...bindings,
          ALLOWED_ORIGINS: '["https://allowed.example"]',
        },
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
        origin === "https://allowed.example" ? origin : null,
      );
      expect(response.headers.get("Access-Control-Expose-Headers")).toBe(
        origin === "https://allowed.example"
          ? "X-Proxy-Models-Cache,X-Proxy-Models-Truncated"
          : null,
      );
      expect(response.headers.get("Vary")).toBe("Accept-Encoding, Origin");
      expect(upstream.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(response.body).toBe(upstream.body);
      expect(await response.text()).toBe("upstream");
    },
  );

  it.each([
    new Error("private implementation detail"),
    { secret: "private implementation detail" },
  ])(
    "contains thrown values and logs the final error status once",
    async (thrown) => {
      vi.spyOn(Config, "aiGateway").mockImplementation(() => {
        throw thrown;
      });
      const info = vi.spyOn(console, "info").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});
      const response = await request("/v1/messages", {
        method: "POST",
        headers: { Origin: "https://client.example" },
      });
      expect(response.status).toBe(500);
      expect(response.headers.get("Vary")).toBe("Origin");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toEqual({
        type: "error",
        error: { type: "api_error", message: "Internal Server Error" },
      });
      const completed = info.mock.calls
        .map(([event]) => event)
        .filter((event) => event.event === "request.completed");
      expect(completed).toHaveLength(1);
      expect(completed[0]).toMatchObject({ status: 500 });
    },
  );

  it("retains HEAD as the upstream method while Hono suppresses the response body", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("provider body", {
        headers: { "X-Upstream": "preserved" },
      }),
    );
    const response = await request("/openai/v1/models", { method: "HEAD" });
    expect(fetch.mock.calls[0][1]?.method).toBe("HEAD");
    expect(response.headers.get("X-Upstream")).toBe("preserved");
    expect(response.body).toBeNull();
  });
});
