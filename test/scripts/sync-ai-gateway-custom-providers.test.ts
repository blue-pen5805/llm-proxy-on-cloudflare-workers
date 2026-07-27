import {
  buildCustomProviderTargets,
  syncAiGatewayCustomProviders,
} from "../../scripts/sync-ai-gateway-custom-providers";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const logoSources = vi.hoisted(() => ({
  cline: '<svg id="cline"/>',
  "nvidia-nim": '<svg id="nvidia-nim"/>',
  ollama: '<svg id="ollama"/>',
}));

vi.mock("node:fs", () => ({
  readFileSync: vi.fn((path: string | URL, encoding: BufferEncoding) => {
    const providerName = String(path).includes("nvidia-nim")
      ? "nvidia-nim"
      : String(path).includes("cline")
        ? "cline"
        : "ollama";
    const source = logoSources[providerName];
    return encoding === "base64"
      ? Buffer.from(source, "utf8").toString("base64")
      : source;
  }),
}));

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
    const ollamaLogo = readFileSync(
      join(import.meta.dirname, "../../src/providers/ollama/logo.svg"),
      "base64",
    );
    expect(buildCustomProviderTargets(strictConfig)).toEqual(
      expect.arrayContaining([
        {
          name: "LLM Proxy / ollama",
          slug: "llm-proxy-ollama",
          baseUrl: "https://ollama.com/v1",
          logo: ollamaLogo,
        },
        {
          name: "LLM Proxy / internal",
          slug: "llm-proxy-internal",
          baseUrl: "https://internal.example/v1",
        },
        {
          name: "LLM Proxy / cline",
          slug: "llm-proxy-cline",
          baseUrl: "https://api.cline.bot/api/v1",
          logo: Buffer.from(logoSources.cline, "utf8").toString("base64"),
        },
      ]),
    );
  });

  it("plans one definition per provider regardless of credential profiles", () => {
    const targets = buildCustomProviderTargets({
      ...strictConfig,
      OLLAMA_API_KEY: { default: "ollama-default", second: "ollama-second" },
      CUSTOM_OPENAI_ENDPOINTS: [
        {
          name: "internal",
          baseUrl: "https://internal.example/v1",
          apiKeys: { default: "internal-default", staging: "internal-staging" },
        },
      ],
    });

    expect(targets.filter(({ name }) => name.includes("ollama"))).toEqual([
      expect.objectContaining({
        name: "LLM Proxy / ollama",
        slug: "llm-proxy-ollama",
        baseUrl: "https://ollama.com/v1",
      }),
    ]);
    expect(targets.filter(({ name }) => name.includes("internal"))).toEqual([
      expect.objectContaining({
        name: "LLM Proxy / internal",
        slug: "llm-proxy-internal",
        baseUrl: "https://internal.example/v1",
      }),
    ]);
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

  it("uses defaults when strict mode is disabled", async () => {
    await expect(syncAiGatewayCustomProviders({})).resolves.toMatchObject({
      enabled: false,
      dryRun: false,
    });
    expect(buildCustomProviderTargets({})).toEqual([]);
    expect(
      buildCustomProviderTargets({ ALWAYS_USE_AI_GATEWAY: "true" }),
    ).not.toEqual([]);
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
    const logosByName = new Map<string, string>();
    for (const [, init] of writes) {
      const body = String(init?.body);
      expect(body).not.toContain("provider-secret");
      const payload = JSON.parse(body) as { name: string; logo?: string };
      if (payload.logo) logosByName.set(payload.name, payload.logo);
      expect(init?.headers).toEqual(
        expect.objectContaining({
          Authorization: "Bearer cloudflare-token",
        }),
      );
    }
    expect([...logosByName.keys()].sort()).toEqual([
      "LLM Proxy / cline",
      "LLM Proxy / nvidia-nim",
      "LLM Proxy / ollama",
    ]);
    expect(
      Buffer.from(
        logosByName.get("LLM Proxy / nvidia-nim")!,
        "base64",
      ).toString("utf8"),
    ).toBe(
      readFileSync(
        join(import.meta.dirname, "../../src/providers/nvidia-nim/logo.svg"),
        "utf8",
      ),
    );
  });

  it("updates a managed Base URL to the version sentinel form", async () => {
    const targets = buildCustomProviderTargets(strictConfig);
    const changed = targets.find(
      ({ name }) => name === "LLM Proxy / internal",
    )!;
    const unchanged = targets.find((target) => target !== changed)!;
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (!init?.method) {
          return apiResponse(
            [
              {
                id: "changed-id",
                name: changed.name,
                slug: changed.slug,
                base_url: "https://internal.example/",
                enable: true,
              },
              {
                id: "unchanged-id",
                name: unchanged.name,
                slug: unchanged.slug,
                base_url: unchanged.baseUrl,
                enable: true,
                logo: unchanged.logo,
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

  it("updates a managed provider when its configured logo differs", async () => {
    const target = buildCustomProviderTargets(strictConfig).find(
      ({ name }) => name === "LLM Proxy / ollama",
    )!;
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (!init?.method) {
          return apiResponse(
            [
              {
                id: "ollama-id",
                name: target.name,
                slug: target.slug,
                base_url: target.baseUrl,
                enable: true,
                logo: "stale-logo",
              },
            ],
            { total_count: 1 },
          );
        }
        return apiResponse({ id: "ollama-id" });
      },
    );

    const result = await syncAiGatewayCustomProviders(
      strictConfig,
      false,
      fetchMock,
    );
    expect(result.updated).toBe(1);
    const update = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith("/ollama-id") && init?.method === "PATCH",
    );
    expect(JSON.parse(String(update?.[1]?.body))).toEqual(
      expect.objectContaining({ logo: target.logo }),
    );
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

  it("rejects malformed Cloudflare response envelopes and lists", async () => {
    for (const payload of [
      null,
      {},
      { success: false, result: [] },
      { success: true },
      { success: true, result: {} },
    ]) {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      await expect(
        syncAiGatewayCustomProviders(strictConfig, false, fetchMock),
      ).rejects.toThrow("invalid JSON");
    }
  });

  it("paginates provider listings and rejects duplicate slugs", async () => {
    const duplicate = {
      id: "duplicate",
      name: "duplicate",
      slug: "duplicate-slug",
      base_url: "https://example.com",
      enable: true,
    };
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      ...duplicate,
      id: `provider-${index}`,
      slug: index < 2 ? duplicate.slug : `slug-${index}`,
    }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(apiResponse(firstPage, { total_count: 101 }))
      .mockResolvedValueOnce(
        apiResponse([{ ...duplicate, slug: "last-slug" }], {
          total_count: 101,
        }),
      );

    await expect(
      syncAiGatewayCustomProviders(strictConfig, false, fetchMock),
    ).rejects.toThrow("duplicate AI Gateway Custom Provider slugs");
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
