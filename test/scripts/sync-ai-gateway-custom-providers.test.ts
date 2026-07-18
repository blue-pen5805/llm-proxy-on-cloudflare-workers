import {
  buildCustomProviderTargets,
  syncAiGatewayCustomProviders,
} from "../../scripts/sync-ai-gateway-custom-providers";
import { beforeEach, describe, expect, it, vi } from "vitest";

const strictConfig = {
  ALWAYS_USE_AI_GATEWAY: true,
  CLOUDFLARE_ACCOUNT_ID: "account-id",
  CLOUDFLARE_API_TOKEN: "cloudflare-token",
  CUSTOM_OPENAI_ENDPOINTS: [
    {
      name: "internal",
      baseUrl: "https://internal.example/v1",
      apiKeys: ["provider-secret"],
    },
  ],
};

function apiResponse(result: unknown, resultInfo?: Record<string, number>) {
  return new Response(
    JSON.stringify({ success: true, result, result_info: resultInfo }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("AI Gateway Custom Provider synchronization", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("plans unsupported built-ins and configured custom endpoints", () => {
    expect(buildCustomProviderTargets(strictConfig)).toEqual(
      expect.arrayContaining([
        {
          name: "LLM Proxy / ollama",
          slug: "llm-proxy-ollama",
          baseUrl: "https://ollama.com/v1",
        },
        {
          name: "LLM Proxy / internal",
          slug: "llm-proxy-internal",
          baseUrl: "https://internal.example/v1",
        },
      ]),
    );
  });

  it("does not contact Cloudflare when strict mode is disabled", async () => {
    const fetchMock = vi.fn();
    await expect(
      syncAiGatewayCustomProviders({}, false, fetchMock),
    ).resolves.toEqual({
      enabled: false,
      desired: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      dryRun: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates strict-mode deployment prerequisites even during dry-run", async () => {
    await expect(
      syncAiGatewayCustomProviders({ ALWAYS_USE_AI_GATEWAY: true }, true),
    ).rejects.toThrow("requires CLOUDFLARE_ACCOUNT_ID");
    await expect(
      syncAiGatewayCustomProviders(
        {
          ALWAYS_USE_AI_GATEWAY: true,
          CLOUDFLARE_ACCOUNT_ID: "account-id",
        },
        true,
      ),
    ).rejects.toThrow("requires CLOUDFLARE_API_TOKEN");
  });

  it("reports a redacted dry-run plan without contacting Cloudflare", async () => {
    const fetchMock = vi.fn();
    const result = await syncAiGatewayCustomProviders(
      strictConfig,
      true,
      fetchMock,
    );
    expect(result.enabled).toBe(true);
    expect(result.desired).toBeGreaterThanOrEqual(2);
    expect(result.dryRun).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates missing definitions without sending provider credentials", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (!init?.method) return apiResponse([], { total_count: 0 });
        return apiResponse({ id: "created" });
      },
    );

    const result = await syncAiGatewayCustomProviders(
      strictConfig,
      false,
      fetchMock,
    );

    expect(result.created).toBe(result.desired);
    const writes = fetchMock.mock.calls.filter(([, init]) => init?.method);
    expect(writes.length).toBe(result.desired);
    for (const [, init] of writes) {
      const body = String(init?.body);
      expect(body).not.toContain("provider-secret");
      expect(init?.headers).toEqual(
        expect.objectContaining({
          Authorization: "Bearer cloudflare-token",
        }),
      );
    }
  });

  it("updates a changed managed definition and leaves matches unchanged", async () => {
    const targets = buildCustomProviderTargets(strictConfig);
    const [changed, unchanged] = targets;
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (!init?.method) {
          return apiResponse(
            [
              {
                id: "changed-id",
                name: changed.name,
                slug: changed.slug,
                base_url: "https://old.example",
                enable: true,
              },
              {
                id: "unchanged-id",
                name: unchanged.name,
                slug: unchanged.slug,
                base_url: unchanged.baseUrl,
                enable: true,
              },
            ],
            { total_count: 2 },
          );
        }
        return apiResponse({ id: "written" });
      },
    );

    const result = await syncAiGatewayCustomProviders(
      strictConfig,
      false,
      fetchMock,
    );
    expect(result.updated).toBe(1);
    expect(result.unchanged).toBe(1);
    expect(result.created).toBe(result.desired - 2);
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input).endsWith("/changed-id") && init?.method === "PATCH",
      ),
    ).toBe(true);
  });

  it("fails safely without echoing a Cloudflare response body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response("sensitive upstream diagnostic", { status: 403 }),
      );
    await expect(
      syncAiGatewayCustomProviders(strictConfig, false, fetchMock),
    ).rejects.toThrow("failed with HTTP 403");
    await expect(
      syncAiGatewayCustomProviders(strictConfig, false, fetchMock),
    ).rejects.not.toThrow("sensitive upstream diagnostic");
  });

  it("does not overwrite an unrelated definition with the managed slug", async () => {
    const [target] = buildCustomProviderTargets(strictConfig);
    const fetchMock = vi.fn().mockResolvedValue(
      apiResponse(
        [
          {
            id: "unrelated",
            name: "Operator-owned provider",
            slug: target.slug,
            base_url: target.baseUrl,
            enable: true,
          },
        ],
        { total_count: 1 },
      ),
    );

    await expect(
      syncAiGatewayCustomProviders(strictConfig, false, fetchMock),
    ).rejects.toThrow("already owned by another definition");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
