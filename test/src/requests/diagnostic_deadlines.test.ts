import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderRegistry } from "~/src/providers";
import { defineProvider } from "~/src/providers/provider";
import { handleModelsRequest } from "~/src/requests/models";
import { handleStatusRequest } from "~/src/requests/status";
import { Environments } from "~/src/utils/environments";
import { createTestRoutedContext } from "../../helpers/request_context";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

const modelProvider = defineProvider({
  getApiKeys: () => ["example-key"],
  endpoints: { models: { path: "/models" } },
});

describe("diagnostic deadlines", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("bounds credential preparation and prevents a late status subrequest", async () => {
    const headers = deferred<HeadersInit>();
    const providers = new ProviderRegistry({
      slow: modelProvider,
      healthy: modelProvider,
    });
    const slow = providers.get("slow")!;
    vi.spyOn(slow, "buildHeadersForPath").mockReturnValue(headers.promise);
    const send = vi.spyOn(slow, "send");
    vi.spyOn(providers.get("healthy")!, "send").mockResolvedValue(
      new Response(null),
    );
    const context = createTestRoutedContext({ providers });
    const result = Environments.run(context.env, () =>
      handleStatusRequest(undefined, providers, context),
    );

    await vi.advanceTimersByTimeAsync(5000);
    const body = await (
      await result
    ).json<{ providers: Record<string, { keys: { status: string }[] }> }>();
    expect(body.providers.slow.keys[0].status).toBe("unknown");
    expect(body.providers.healthy.keys[0].status).toBe("valid");
    headers.resolve({});
    await vi.advanceTimersByTimeAsync(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("bounds response cleanup when upstream cancellation never settles", async () => {
    const cleanup = deferred<void>();
    const cancel = vi.fn(() => cleanup.promise);
    const response = new Response(new ReadableStream<Uint8Array>({ cancel }));
    const providers = new ProviderRegistry({ slow: modelProvider });
    const send = vi
      .spyOn(providers.get("slow")!, "send")
      .mockResolvedValue(response);
    const context = createTestRoutedContext({ providers });
    const result = Environments.run(context.env, () =>
      handleStatusRequest(undefined, providers, context),
    );

    await vi.advanceTimersByTimeAsync(5000);
    const body = await (
      await result
    ).json<{ providers: { slow: { keys: { status: string }[] } } }>();
    expect(body.providers.slow.keys[0].status).toBe("unknown");
    expect(send.mock.calls[0][1]!.signal!.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    cleanup.resolve();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("does not retry discovery when an ignored timeout returns a late 429", async () => {
    const lateResponse = deferred<Response>();
    const providers = new ProviderRegistry({
      slow: defineProvider({
        getApiKeys: () => ["example-first", "example-second"],
        endpoints: { models: { path: "/models" } },
      }),
    });
    const send = vi
      .spyOn(providers.get("slow")!, "send")
      .mockReturnValue(lateResponse.promise);
    const context = createTestRoutedContext({
      providers,
      env: { MODELS_CACHE_TTL_SECONDS: "0" } as Env,
    });
    const result = Environments.run(context.env, () =>
      handleModelsRequest(context),
    );

    await vi.advanceTimersByTimeAsync(60_000);
    expect(await (await result).json()).toEqual({ data: [], object: "list" });
    expect(send.mock.calls[0][1]!.signal!.aborted).toBe(true);
    const cancel = vi.fn();
    lateResponse.resolve(
      new Response(new ReadableStream<Uint8Array>({ cancel }), { status: 429 }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
  });
});
