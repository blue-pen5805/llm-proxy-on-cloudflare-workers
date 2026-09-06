import { waitOnExecutionContext } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderRegistry } from "~/src/providers";
import { defineProvider } from "~/src/providers/provider";
import {
  handleModelsRequest,
  MAX_MODELS_PER_PROVIDER,
} from "~/src/requests/models";
import { Environments } from "~/src/utils/environments";
import { createTestRoutedContext } from "../../helpers/request_context";

function model(id: string) {
  return { id, object: "model", created: 0, owned_by: "test" };
}

function modelProvider() {
  return defineProvider({
    available: () => true,
    endpoints: { models: { path: "/models" } },
  });
}

async function modelsCache() {
  const cache = await caches.open("models-resilience-tests");
  vi.spyOn(caches, "open").mockResolvedValue(cache);
  vi.spyOn(cache, "match").mockResolvedValue(undefined);
  return vi.spyOn(cache, "put").mockResolvedValue(undefined);
}

describe("model discovery failure isolation", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(["", "?provider=unreadable"])(
    "isolates provider enumeration failures for an unfiltered or selected provider (%s)",
    async (query) => {
      const put = await modelsCache();
      const providers = new ProviderRegistry({
        unreadable: defineProvider({
          getCredentialProfiles() {
            throw new Error("unreadable profile configuration");
          },
        }),
        healthy: modelProvider(),
      });
      const send = vi
        .spyOn(providers.get("healthy")!, "send")
        .mockResolvedValue(Response.json({ data: [model("healthy-model")] }));
      const context = createTestRoutedContext({
        providers,
        request: new Request(`https://proxy.example.invalid/v1/models${query}`),
      });
      context.env = { ...context.env, MODELS_CACHE_TTL_SECONDS: "60" };
      const response = await Environments.run(context.env, () =>
        handleModelsRequest(context),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        object: "list",
        data: query ? [] : [model("healthy/healthy-model")],
      });
      expect(send).toHaveBeenCalledTimes(query ? 0 : 1);
      await waitOnExecutionContext(context.ctx);
      expect(put).not.toHaveBeenCalled();
    },
  );

  it.each([null, false, 42, "model", [], {}, { id: 42 }, { id: "" }])(
    "omits a provider with malformed entries (%j) without losing healthy models",
    async (invalidModel) => {
      const put = await modelsCache();
      const providers = new ProviderRegistry({
        malformed: modelProvider(),
        healthy: modelProvider(),
      });
      vi.spyOn(providers.get("malformed")!, "send").mockResolvedValue(
        Response.json({ data: [model("before-invalid"), invalidModel] }),
      );
      vi.spyOn(providers.get("healthy")!, "send").mockResolvedValue(
        Response.json({ data: [model("healthy-model")] }),
      );
      const context = createTestRoutedContext({ providers });
      context.env = { ...context.env, MODELS_CACHE_TTL_SECONDS: "60" };
      const response = await Environments.run(context.env, () =>
        handleModelsRequest(context),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        object: "list",
        data: [model("healthy/healthy-model")],
      });
      await waitOnExecutionContext(context.ctx);
      expect(put).not.toHaveBeenCalled();
    },
  );

  it("reports the per-provider count limit, retains later providers, and avoids caching", async () => {
    const put = await modelsCache();
    const providers = new ProviderRegistry({
      large: modelProvider(),
      small: modelProvider(),
    });
    vi.spyOn(providers.get("large")!, "send").mockResolvedValue(
      Response.json({
        data: Array.from({ length: MAX_MODELS_PER_PROVIDER + 1 }, (_, index) =>
          model(`model-${index}`),
        ),
      }),
    );
    vi.spyOn(providers.get("small")!, "send").mockResolvedValue(
      Response.json({ data: [model("small-model")] }),
    );
    const context = createTestRoutedContext({ providers });
    context.env = { ...context.env, MODELS_CACHE_TTL_SECONDS: "60" };
    const response = await Environments.run(context.env, () =>
      handleModelsRequest(context),
    );
    expect(response.headers.get("X-Proxy-Models-Truncated")).toBe("true");
    const body = await response.json<{ data: { id: string }[] }>();
    expect(body.data).toHaveLength(MAX_MODELS_PER_PROVIDER + 1);
    expect(body.data[0].id).toBe("large/model-0");
    expect(body.data[MAX_MODELS_PER_PROVIDER - 1].id).toBe(
      `large/model-${MAX_MODELS_PER_PROVIDER - 1}`,
    );
    expect(body.data[MAX_MODELS_PER_PROVIDER].id).toBe("small/small-model");
    await waitOnExecutionContext(context.ctx);
    expect(put).not.toHaveBeenCalled();
  });
});
