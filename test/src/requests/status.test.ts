import { describe, it, expect, vi, beforeEach } from "vitest";
import { CloudflareAIGateway } from "~/src/ai_gateway";
import { BUILT_IN_PROVIDER_CONSTRUCTORS } from "~/src/providers";
import { getAllProviderInstances } from "~/src/providers";
import { CustomOpenAI } from "~/src/providers/custom-openai";
import {
  createProvider,
  ProviderNotSupportedError,
} from "~/src/providers/provider";
import { handleStatusRequest } from "~/src/requests/status";
import { Config } from "~/src/utils/config";
import { Environments } from "~/src/utils/environments";
import { fetchWithLogging, withTimeout } from "~/src/utils/helpers";
import { Secrets } from "~/src/utils/secrets";

vi.mock("~/src/providers", async () => {
  const actual =
    await vi.importActual<typeof import("~/src/providers")>("~/src/providers");
  return {
    ...actual,
    getAllProviderInstances: vi.fn(),
  };
});
vi.mock("~/src/utils/config");
vi.mock("~/src/utils/environments");
vi.mock("~/src/utils/secrets");
vi.mock("~/src/utils/helpers");

describe("status", () => {
  const mockProviderClass = {
    ...createProvider(),
    endpoints: {
      models: { path: "/models", validate: vi.fn(), supportsAiGateway: true },
    },

    apiKeyName: "OPENAI_API_KEY",
    baseUrl: vi.fn(() => "https://api.example.com"),

    available: vi.fn(),
    getApiKeys: vi.fn(() => Secrets.getAll("OPENAI_API_KEY")),

    send: vi.fn(),
    headers: vi.fn().mockResolvedValue({ Authorization: "Bearer key" }),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Clear the built-in provider constructor map.
    Object.keys(BUILT_IN_PROVIDER_CONSTRUCTORS).forEach((key) => {
      delete BUILT_IN_PROVIDER_CONSTRUCTORS[key];
    });

    vi.mocked(Config.isDevelopment).mockReturnValue(false);
    vi.mocked(Config.defaultModel).mockReturnValue("gpt-4");
    vi.mocked(Config.aiGateway).mockReturnValue({
      accountId: "acc-123",
      name: "gw-123",
      token: "tok-123",
      restApiToken: "rest-tok-123",
      alwaysUse: false,
    });
    vi.mocked(Config.apiKeyCooldownSeconds).mockReturnValue(60);
    vi.mocked(Config.chatResponseMetadataEnabled).mockReturnValue(false);
    vi.mocked(Config.statusCacheTtlSeconds).mockReturnValue(0);

    vi.mocked(Environments.getEnv).mockReturnValue({} as Env);
    vi.mocked(Environments.all).mockReturnValue({} as any);

    BUILT_IN_PROVIDER_CONSTRUCTORS.openai = vi.fn(function () {
      const instance = Object.create(mockProviderClass);
      instance.apiKeyName = "OPENAI_API_KEY";
      return instance;
    }) as unknown as (typeof BUILT_IN_PROVIDER_CONSTRUCTORS)[string];

    vi.mocked(getAllProviderInstances).mockImplementation(() => {
      return Object.fromEntries(
        Object.keys(BUILT_IN_PROVIDER_CONSTRUCTORS).map((key) => [
          key,
          new (BUILT_IN_PROVIDER_CONSTRUCTORS[key] as any)(),
        ]),
      );
    });

    mockProviderClass.available.mockReturnValue(true);
    mockProviderClass.endpoints.models.supportsAiGateway = true;
    mockProviderClass.endpoints.models.validate.mockReturnValue([
      "/models",
      { method: "GET" },
    ]);
    vi.mocked(withTimeout).mockImplementation(async (promise) => promise);
  });

  it("should return structured JSON with config and provider status", async () => {
    vi.mocked(Secrets.getAll).mockReturnValue(["sk-123456789", "sk-abcdefghi"]);
    mockProviderClass.send.mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    const response = await handleStatusRequest();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");

    const responseText = await response.text();
    const body = JSON.parse(responseText) as any;
    expect(responseText).toBe(JSON.stringify(body));
    expect(responseText).not.toContain("\n");
    expect(body.config).toEqual({
      DEV: false,
      DEFAULT_MODEL: "gpt-4",
      CHAT_RESPONSE_METADATA_ENABLED: false,
      AI_GATEWAY: {
        accountId: "acc-123",
        name: "gw-123",
        token: "***",
        restApiToken: "***",
        alwaysUse: false,
      },
      API_KEY_COOLDOWN_SECONDS: 60,
      STATUS_CACHE_TTL_SECONDS: 0,
    });

    expect(body.providers.openai).toBeDefined();
    expect(body.providers.openai.available).toBe(true);
    expect(body.providers.openai.keys).toHaveLength(2);
    expect(body.providers.openai.keys[0]).toEqual({
      slot: 0,
      status: "valid",
    });
    expect(body.providers.openai.keys[1]).toEqual({
      slot: 1,
      status: "valid",
    });
  });

  it("reports named profiles under their selector", async () => {
    const profiledProvider = {
      ...mockProviderClass,
      available: vi.fn().mockReturnValue(true),
      getApiKeys: vi.fn().mockReturnValue(["paid-key"]),
      send: vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
    };

    const response = await handleStatusRequest(undefined, {
      allSettled: () => ({
        providers: { "openai:paid": profiledProvider },
        failures: [],
      }),
    } as any);
    const body = (await response.json()) as any;

    expect(body.providers["openai:paid"]).toEqual({
      available: true,
      keys: [{ slot: 0, status: "valid" }],
    });
  });

  it("should handle invalid API keys", async () => {
    vi.mocked(Secrets.getAll).mockReturnValue(["invalid-key"]);
    mockProviderClass.send.mockResolvedValue(
      new Response(null, { status: 401 }),
    );

    const response = await handleStatusRequest();
    const body = (await response.json()) as any;

    expect(body.providers.openai.keys[0].status).toBe("invalid");
  });

  it("should handle unknown status for other error codes", async () => {
    vi.mocked(Secrets.getAll).mockReturnValue(["unknown-key"]);
    mockProviderClass.send.mockResolvedValue(
      new Response(null, { status: 500 }),
    );

    const response = await handleStatusRequest();
    const body = (await response.json()) as any;

    expect(body.providers.openai.keys[0].status).toBe("unknown");
  });

  it("should handle providers without API keys", async () => {
    BUILT_IN_PROVIDER_CONSTRUCTORS.nokeys = vi.fn(function () {
      return {
        apiKeyName: undefined,
        available: vi.fn().mockReturnValue(true),
        getApiKeys: vi.fn().mockReturnValue([]),
      };
    }) as unknown as (typeof BUILT_IN_PROVIDER_CONSTRUCTORS)[string];

    const response = await handleStatusRequest();
    const body = (await response.json()) as any;

    expect(body.providers.nokeys).toEqual({
      available: true,
      keys: [],
    });
  });

  it("omits the AI Gateway token field when no token is configured", async () => {
    vi.mocked(Config.aiGateway).mockReturnValue({
      accountId: "acc-123",
      name: "gw-123",
      token: undefined,
      restApiToken: undefined,
      alwaysUse: false,
    });
    vi.mocked(Secrets.getAll).mockReturnValue([]);

    const body = (await (await handleStatusRequest()).json()) as any;

    expect(body.config.AI_GATEWAY).toEqual({
      accountId: "acc-123",
      name: "gw-123",
      alwaysUse: false,
    });
  });

  it("never returns key material or key suffixes", async () => {
    vi.mocked(Secrets.getAll).mockReturnValue([
      "short",
      "longest-key-ever-123",
    ]);
    mockProviderClass.send.mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    const response = await handleStatusRequest();
    const body = (await response.json()) as any;

    expect(body.providers.openai.keys).toEqual([
      { slot: 0, status: "valid" },
      { slot: 1, status: "valid" },
    ]);
    expect(JSON.stringify(body.providers)).not.toContain("ort");
    expect(JSON.stringify(body.providers)).not.toContain("123");
  });

  it("should skip connectivity check when models are not declared", async () => {
    BUILT_IN_PROVIDER_CONSTRUCTORS.skip = vi.fn(function () {
      return {
        apiKeyName: "SKIP_API_KEY",
        endpoints: {},
        available: vi.fn().mockReturnValue(true),
        getApiKeys: vi.fn(() => Secrets.getAll("SKIP_API_KEY" as keyof Env)),
      };
    }) as unknown as (typeof BUILT_IN_PROVIDER_CONSTRUCTORS)[string];
    vi.mocked(Secrets.getAll).mockReturnValue(["any-key"]);

    const response = await handleStatusRequest();
    const body = (await response.json()) as any;

    expect(body.providers.skip.keys[0].status).toBe("unknown");
  });

  it("handles custom endpoint keys and keys of at most three characters", async () => {
    const custom = new CustomOpenAI({
      name: "custom",
      baseUrl: "https://custom.example",
      apiKeys: ["abc", "x"],
    });
    vi.mocked(fetchWithLogging).mockResolvedValue(
      new Response(null, { status: 200 }),
    );
    vi.mocked(getAllProviderInstances).mockReturnValue({ custom });
    vi.mocked(Config.defaultModel).mockReturnValue(undefined);

    const response = await handleStatusRequest();
    const body = (await response.json()) as any;

    expect(body.config.DEFAULT_MODEL).toBeNull();
    expect(body.providers.custom.keys).toEqual([
      { slot: 0, status: "valid" },
      { slot: 1, status: "valid" },
    ]);
    expect(Secrets.getAll).not.toHaveBeenCalled();
  });

  it("treats unsupported model listing as unknown connectivity", async () => {
    vi.mocked(Secrets.getAll).mockReturnValue(["key"]);
    mockProviderClass.endpoints.models.validate.mockImplementation(() => {
      throw new ProviderNotSupportedError("unsupported");
    });

    const response = await handleStatusRequest();
    const body = (await response.json()) as any;

    expect(body.providers.openai.keys[0].status).toBe("unknown");
  });

  it("treats timed out connectivity checks as unknown", async () => {
    const timeoutError = new Error("timed out");
    timeoutError.name = "TimeoutError";
    vi.mocked(Secrets.getAll).mockReturnValue(["key"]);
    vi.mocked(withTimeout).mockRejectedValue(timeoutError);

    const response = await handleStatusRequest();
    const body = (await response.json()) as any;

    expect(body.providers.openai.keys[0].status).toBe("unknown");
    expect(withTimeout).toHaveBeenCalledWith(
      expect.any(Promise),
      expect.any(AbortController),
      5000,
      "openai",
    );
  });

  it("reports unexpected connectivity failures as invalid", async () => {
    const error = new Error("network unavailable");
    vi.mocked(Secrets.getAll).mockReturnValue(["key"]);
    mockProviderClass.endpoints.models.validate.mockImplementation(() => {
      throw error;
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const response = await handleStatusRequest();
    const body = (await response.json()) as any;

    expect(body.providers.openai.keys[0].status).toBe("invalid");
    expect(consoleError).toHaveBeenCalledWith({
      event: "provider.connectivity.failed",
      request_id: null,
      provider: "openai",
      error_name: "Error",
      error_message: "network unavailable",
      message:
        "Provider connectivity check failed: provider=openai, error_name=Error, error_message=network unavailable",
    });
  });

  it("leaves a credential unknown when the subrequest limit is exhausted", async () => {
    vi.mocked(Secrets.getAll).mockReturnValue(["key"]);
    mockProviderClass.send.mockRejectedValue(
      new Error("Too many subrequests."),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await handleStatusRequest();
    const body = (await response.json()) as any;

    expect(body.providers.openai.keys[0].status).toBe("unknown");
  });

  it("checks supported providers through AI Gateway", async () => {
    vi.mocked(Secrets.getAll).mockReturnValue(["valid", "invalid", "unknown"]);
    vi.spyOn(CloudflareAIGateway, "isSupportedProvider").mockReturnValue(true);
    vi.mocked(fetchWithLogging)
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));
    const gateway = {
      buildProviderEndpointRequest: vi
        .fn()
        .mockReturnValue(["https://gateway.example/models", { method: "GET" }]),
    } as any;

    const response = await handleStatusRequest(gateway);
    const body = (await response.json()) as any;

    expect(body.providers.openai.keys.map((key: any) => key.status)).toEqual([
      "valid",
      "invalid",
      "unknown",
    ]);
    expect(gateway.buildProviderEndpointRequest).toHaveBeenCalledTimes(3);
    expect(mockProviderClass.send).not.toHaveBeenCalled();
    expect(fetchWithLogging).toHaveBeenCalledWith(
      "https://gateway.example/models",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("uses direct connectivity when Gateway model discovery is unsupported", async () => {
    vi.mocked(Secrets.getAll).mockReturnValue(["key"]);
    mockProviderClass.endpoints.models.supportsAiGateway = false;
    mockProviderClass.send.mockResolvedValue(
      new Response(null, { status: 200 }),
    );
    const gateway = {
      buildProviderEndpointRequest: vi.fn(),
    } as any;

    const body = (await (await handleStatusRequest(gateway)).json()) as any;

    expect(body.providers.openai.keys[0].status).toBe("valid");
    expect(mockProviderClass.send).toHaveBeenCalledOnce();
    expect(gateway.buildProviderEndpointRequest).not.toHaveBeenCalled();
    expect(fetchWithLogging).not.toHaveBeenCalled();
  });

  it("uses a Custom Provider for unsupported connectivity in strict mode", async () => {
    vi.mocked(Secrets.getAll).mockReturnValue(["key"]);
    mockProviderClass.endpoints.models.supportsAiGateway = false;
    vi.spyOn(CloudflareAIGateway, "isSupportedProvider").mockReturnValue(false);
    vi.mocked(fetchWithLogging).mockResolvedValue(
      new Response(null, { status: 200 }),
    );
    const gateway = {
      alwaysUse: true,
      buildProviderEndpointRequest: vi
        .fn()
        .mockReturnValue([
          "https://gateway.example/custom-llm-proxy-openai/models",
          { method: "GET" },
        ]),
    } as any;

    const body = (await (await handleStatusRequest(gateway)).json()) as any;

    expect(body.providers.openai.keys[0].status).toBe("valid");
    expect(gateway.buildProviderEndpointRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "custom-llm-proxy-openai",
        path: "/models",
      }),
    );
    expect(mockProviderClass.send).not.toHaveBeenCalled();
  });

  it("reports unknown when neither Gateway nor direct model discovery is supported", async () => {
    vi.mocked(Secrets.getAll).mockReturnValue(["key"]);
    mockProviderClass.endpoints.models.supportsAiGateway = false;
    mockProviderClass.endpoints.models.validate.mockImplementation(() => {
      throw new ProviderNotSupportedError("unsupported");
    });
    const gateway = {
      buildProviderEndpointRequest: vi.fn(),
    } as any;

    const body = (await (await handleStatusRequest(gateway)).json()) as any;

    expect(body.providers.openai.keys[0].status).toBe("unknown");
    expect(gateway.buildProviderEndpointRequest).not.toHaveBeenCalled();
    expect(fetchWithLogging).not.toHaveBeenCalled();
  });

  it("checks different providers concurrently while preserving output order", async () => {
    let releaseFirst: (response: Response) => void = () => {};
    const firstResponse = new Promise<Response>((resolve) => {
      releaseFirst = resolve;
    });
    const first = {
      ...mockProviderClass,
      endpoints: {
        models: {
          ...mockProviderClass.endpoints.models,
          validate: vi.fn().mockResolvedValue(["/models", {}]),
        },
      },
      apiKeyName: "FIRST_API_KEY",
      available: vi.fn().mockReturnValue(true),

      send: vi.fn().mockReturnValue(firstResponse),
    };
    const second = {
      ...mockProviderClass,
      endpoints: {
        models: {
          ...mockProviderClass.endpoints.models,
          validate: vi.fn().mockResolvedValue(["/models", {}]),
        },
      },
      apiKeyName: "SECOND_API_KEY",
      available: vi.fn().mockReturnValue(true),

      send: vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
    };
    vi.mocked(getAllProviderInstances).mockReturnValue({
      first,
      second,
    } as any);
    vi.mocked(Secrets.getAll).mockReturnValue(["key"]);

    const statusPromise = handleStatusRequest();
    await vi.waitFor(() => expect(second.send).toHaveBeenCalledOnce());
    releaseFirst(new Response(null, { status: 200 }));

    const body = (await (await statusPromise).json()) as any;
    expect(Object.keys(body.providers)).toEqual(["first", "second"]);
  });

  it("starts every configured credential check without a concurrency cap", async () => {
    const apiKeyCount = 34;
    let activeChecks = 0;
    let maximumActiveChecks = 0;
    vi.mocked(Secrets.getAll).mockReturnValue(
      Array.from({ length: apiKeyCount }, (_, index) => `key-${index}`),
    );
    mockProviderClass.send.mockImplementation(async () => {
      activeChecks++;
      maximumActiveChecks = Math.max(maximumActiveChecks, activeChecks);
      await Promise.resolve();
      activeChecks--;
      return new Response(null, { status: 200 });
    });

    const body = (await (await handleStatusRequest()).json()) as any;
    expect(mockProviderClass.send).toHaveBeenCalledTimes(apiKeyCount);
    expect(maximumActiveChecks).toBe(apiKeyCount);
    expect(body.providers.openai.keys.at(-1)).toEqual({
      slot: apiKeyCount - 1,
      status: "valid",
    });
  });

  it("cancels diagnostic response bodies after classifying headers", async () => {
    vi.mocked(Secrets.getAll).mockReturnValue(["key"]);
    const upstreamResponse = new Response("unused", { status: 200 });
    const cancel = vi.spyOn(upstreamResponse.body!, "cancel");
    mockProviderClass.send.mockResolvedValue(upstreamResponse);

    await handleStatusRequest();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("keeps the classified status when response-body cancellation fails", async () => {
    vi.mocked(Secrets.getAll).mockReturnValue(["key"]);
    const upstreamResponse = new Response("unused", { status: 200 });
    vi.spyOn(upstreamResponse.body!, "cancel").mockRejectedValue(
      new Error("already locked"),
    );
    mockProviderClass.send.mockResolvedValue(upstreamResponse);

    const body = (await (await handleStatusRequest()).json()) as any;
    expect(body.providers.openai.keys[0].status).toBe("valid");
  });

  it("still reports other providers when one cannot describe itself", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(Secrets.getAll).mockReturnValue(["key"]);
    mockProviderClass.send.mockResolvedValue(
      new Response(null, { status: 200 }),
    );
    vi.mocked(getAllProviderInstances).mockReturnValue({
      broken: {
        ...mockProviderClass,
        getApiKeys: vi.fn(() => {
          throw new Error("credential configuration is unreadable");
        }),
      },
      openai: mockProviderClass,
    } as any);

    const response = await handleStatusRequest();
    const body = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(body.providers.broken).toEqual({ available: false, keys: [] });
    expect(body.providers.openai.keys[0].status).toBe("valid");
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: "provider.status.failed" }),
    );
  });

  it("reports a provider that fails during registry enumeration", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await handleStatusRequest(undefined, {
      allSettled: () => ({
        providers: {},
        failures: [
          {
            providerName: "broken",
            error: new Error("profile configuration is unreadable"),
          },
        ],
      }),
    } as any);
    const body = (await response.json()) as any;

    expect(body.providers.broken).toEqual({ available: false, keys: [] });
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "provider.status.failed",
        provider: "broken",
      }),
    );
  });

  it("still returns a diagnostic when a connectivity check rejects outright", async () => {
    // A rejection raised outside the per-check guard — for example the Worker's
    // per-request subrequest budget being exhausted while the check is being
    // set up — must leave the slot unresolved instead of failing the route.
    let modelsPathReads = 0;
    vi.mocked(getAllProviderInstances).mockReturnValue({
      openai: {
        ...mockProviderClass,
        available: vi.fn(() => true),
        getApiKeys: vi.fn(() => ["key"]),
        endpoints: {
          models: {
            get path() {
              modelsPathReads += 1;
              if (modelsPathReads > 1) throw new Error("Too many subrequests.");
              return "/models";
            },
          },
        },
      },
    } as any);

    const response = await handleStatusRequest();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      providers: {
        openai: { available: true, keys: [{ slot: 0, status: "unknown" }] },
      },
    });
  });

  it("serves an enabled status-cache hit with no-store headers", async () => {
    vi.mocked(Config.statusCacheTtlSeconds).mockReturnValue(30);
    const cache = {
      match: vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { config: { cached: true }, providers: {} },
            { headers: { "Cache-Control": "public, max-age=30" } },
          ),
        ),
      put: vi.fn(),
    } as unknown as Cache;
    vi.spyOn(caches, "open").mockResolvedValue(cache);
    const context = {
      request: new Request("https://proxy.example/status"),
      ctx: { waitUntil: vi.fn() },
    } as any;

    const response = await handleStatusRequest(
      {
        accountId: "acc",
        gatewayId: "cached",
        alwaysUse: false,
      } as CloudflareAIGateway,
      undefined,
      context,
    );
    expect(response.headers.get("X-Proxy-Status-Cache")).toBe("HIT");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("partitions status cache for strict Gateway routing", async () => {
    vi.mocked(Config.statusCacheTtlSeconds).mockReturnValue(30);
    vi.mocked(getAllProviderInstances).mockReturnValue({});
    const cache = {
      match: vi.fn().mockResolvedValue(undefined),
      put: vi.fn().mockResolvedValue(undefined),
    } as unknown as Cache;
    vi.spyOn(caches, "open").mockResolvedValue(cache);
    const context = {
      request: new Request("https://proxy.example/status"),
      ctx: { waitUntil: vi.fn() },
    } as any;
    await handleStatusRequest(
      {
        accountId: "acc",
        gatewayId: "strict",
        alwaysUse: true,
      } as CloudflareAIGateway,
      undefined,
      context,
    );
    expect(cache.match).toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.stringContaining("/acc/strict/always"),
      }),
    );
  });

  it("writes a status-cache miss in waitUntil", async () => {
    vi.mocked(Config.statusCacheTtlSeconds).mockReturnValue(30);
    vi.mocked(getAllProviderInstances).mockReturnValue({});
    const cache = {
      match: vi.fn().mockResolvedValue(undefined),
      put: vi.fn().mockResolvedValue(undefined),
    } as unknown as Cache;
    vi.spyOn(caches, "open").mockResolvedValue(cache);
    const waitUntil = vi.fn();
    const context = {
      request: new Request("https://proxy.example/status", {
        headers: { "Cache-Control": "no-cache" },
      }),
      ctx: { waitUntil },
    } as any;

    const response = await handleStatusRequest(undefined, undefined, context);
    expect(response.headers.get("X-Proxy-Status-Cache")).toBe("MISS");
    expect(cache.match).not.toHaveBeenCalled();
    expect(cache.put).toHaveBeenCalledOnce();
    expect(waitUntil).toHaveBeenCalledOnce();
  });

  it("keeps a live response when the status-cache write rejects", async () => {
    vi.mocked(Config.statusCacheTtlSeconds).mockReturnValue(30);
    vi.mocked(getAllProviderInstances).mockReturnValue({});
    const cache = {
      match: vi.fn().mockResolvedValue(undefined),
      put: vi.fn().mockRejectedValue(new Error("write failed")),
    } as unknown as Cache;
    vi.spyOn(caches, "open").mockResolvedValue(cache);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const waitUntil = vi.fn();
    const response = await handleStatusRequest(undefined, undefined, {
      request: new Request("https://proxy.example/status"),
      ctx: { waitUntil },
    } as any);
    expect(response.status).toBe(200);
    await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
  });

  it("bypasses or survives an unavailable status cache", async () => {
    vi.mocked(Config.statusCacheTtlSeconds).mockReturnValue(30);
    vi.mocked(getAllProviderInstances).mockReturnValue({});
    const open = vi
      .spyOn(caches, "open")
      .mockRejectedValue(new Error("unavailable"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const baseContext = {
      ctx: { waitUntil: vi.fn() },
    };

    const unavailable = await handleStatusRequest(undefined, undefined, {
      ...baseContext,
      request: new Request("https://proxy.example/status"),
    } as any);
    expect(unavailable.status).toBe(200);

    const bypassed = await handleStatusRequest(undefined, undefined, {
      ...baseContext,
      request: new Request("https://proxy.example/status", {
        headers: { "Cache-Control": "no-store" },
      }),
    } as any);
    expect(bypassed.status).toBe(200);
    expect(open).toHaveBeenCalledOnce();
  });
});
