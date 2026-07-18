import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MiddlewareContext } from "~/src/middleware";
import { providerRegistryMiddleware } from "~/src/middlewares/provider_registry";
import { createProviderRegistry } from "~/src/providers";

vi.mock("~/src/providers", () => ({
  createProviderRegistry: vi.fn(() => ({ names: () => [] })),
}));

describe("providerRegistryMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("installs one request-scoped provider registry", async () => {
    const env = {} as Env;
    const context = { env } as MiddlewareContext;
    const next = vi.fn().mockResolvedValue(new Response());

    await providerRegistryMiddleware(context, next);

    expect(createProviderRegistry).toHaveBeenCalledWith(env);
    expect(context.providers).toBeDefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it("preserves a provider registry already installed by a caller", async () => {
    const providers = { names: () => ["existing"] };
    const context = {
      env: {} as Env,
      providers,
    } as unknown as MiddlewareContext;

    await providerRegistryMiddleware(
      context,
      vi.fn().mockResolvedValue(new Response()),
    );

    expect(context.providers).toBe(providers);
    expect(createProviderRegistry).not.toHaveBeenCalled();
  });
});
