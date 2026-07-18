import { describe, it, expect, vi, beforeEach } from "vitest";
import { CloudflareAIGateway } from "~/src/ai_gateway";
import { BUILT_IN_PROVIDER_CONSTRUCTORS } from "~/src/providers";
import { getAllProviderInstances } from "~/src/providers";
import { CustomOpenAI } from "~/src/providers/custom-openai";
import { ProviderNotSupportedError } from "~/src/providers/provider";
import {
  handleStatusRequest,
  MAX_STATUS_CONNECTIVITY_CHECKS,
} from "~/src/requests/status";
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
    apiKeyName: "OPENAI_API_KEY",
    modelsPath: "/models",
    supportsAiGatewayModels: true,
    available: vi.fn(),
    getApiKeys: vi.fn(() => Secrets.getAll("OPENAI_API_KEY")),
    buildModelsRequest: vi.fn(),
    fetch: vi.fn(),
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
    });
    vi.mocked(Config.isGlobalRoundRobinEnabled).mockReturnValue(true);

    vi.mocked(Environments.getEnv).mockReturnValue({} as Env);
    vi.mocked(Environments.all).mockReturnValue({} as any);

    BUILT_IN_PROVIDER_CONSTRUCTORS.openai = vi.fn(function () {
      const instance = Object.create(mockProviderClass);
      instance.apiKeyName = "OPENAI_API_KEY";
      return instance;
    });

    vi.mocked(getAllProviderInstances).mockImplementation(() => {
      return Object.fromEntries(
        Object.keys(BUILT_IN_PROVIDER_CONSTRUCTORS).map((key) => [
          key,
          new (BUILT_IN_PROVIDER_CONSTRUCTORS[key] as any)(),
        ]),
      );
    });

    mockProviderClass.available.mockReturnValue(true);
    mockProviderClass.supportsAiGatewayModels = true;
    mockProviderClass.buildModelsRequest.mockReturnValue([
      "/models",
      { method: "GET" },
    ]);
    vi.mocked(withTimeout).mockImplementation(async (promise) => promise);
  });

  it("should return structured JSON with config and provider status", async () => {
    vi.mocked(Secrets.getAll).mockReturnValue(["sk-123456789", "sk-abcdefghi"]);
    mockProviderClass.fetch.mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    const response = await handleStatusRequest();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");

    const body = (await response.json()) as any;
    expect(body.config).toEqual({
      DEV: false,
      DEFAULT_MODEL: "gpt-4",
      AI_GATEWAY: {
        accountId: "acc-123",
        name: "gw-123",
        token: "***",
        restApiToken: "***",
      },
      GLOBAL_ROUND_ROBIN: true,
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

  it("should handle invalid API keys", async () => {
    vi.mocked(Secrets.getAll).mockReturnValue(["invalid-key"]);
    mockProviderClass.fetch.mockResolvedValue(
      new Response(null, { status: 401 }),
    );

    const response = await handleStatusRequest();
    const body = (await response.json()) as any;

    expect(body.providers.openai.keys[0].status).toBe("invalid");
  });

  it("should handle unknown status for other error codes", async () => {
    vi.mocked(Secrets.getAll).mockReturnValue(["unknown-key"]);
    mockProviderClass.fetch.mockResolvedValue(
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
    });

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
    });
    vi.mocked(Secrets.getAll).mockReturnValue([]);

    const body = await (await handleStatusRequest()).json();

    expect(body.config.AI_GATEWAY).toEqual({
      accountId: "acc-123",
      name: "gw-123",
    });
  });

  it("never returns key material or key suffixes", async () => {
    vi.mocked(Secrets.getAll).mockReturnValue([
      "short",
      "longest-key-ever-123",
    ]);
    mockProviderClass.fetch.mockResolvedValue(
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

  it("should skip connectivity check when modelsPath is missing", async () => {
    BUILT_IN_PROVIDER_CONSTRUCTORS.skip = vi.fn(function () {
      return {
        apiKeyName: "SKIP_API_KEY",
        modelsPath: "",
        available: vi.fn().mockReturnValue(true),
        getApiKeys: vi.fn(() => Secrets.getAll("SKIP_API_KEY")),
      };
    });
    vi.mocked(Secrets.getAll).mockReturnValue(["any-key"]);

    const response = await handleStatusRequest();
    const body = await response.json();

    expect(body.providers.skip.keys[0].status).toBe("unknown");
  });

  it("handles custom endpoint keys and keys of at most three characters", async () => {
    const custom = new CustomOpenAI({
      name: "custom",
      baseUrl: "https://custom.example",
      apiKeys: ["abc", "x"],
    });
    vi.spyOn(custom, "buildModelsRequest").mockResolvedValue([
      "/models",
      { method: "GET" },
    ]);
    vi.spyOn(custom, "fetch").mockResolvedValue(
      new Response(null, { status: 200 }),
    );
    vi.mocked(getAllProviderInstances).mockReturnValue({ custom });
    vi.mocked(Config.defaultModel).mockReturnValue(undefined);

    const response = await handleStatusRequest();
    const body = await response.json();

    expect(body.config.DEFAULT_MODEL).toBeNull();
    expect(body.providers.custom.keys).toEqual([
      { slot: 0, status: "valid" },
      { slot: 1, status: "valid" },
    ]);
    expect(Secrets.getAll).not.toHaveBeenCalled();
  });

  it("treats unsupported model listing as unknown connectivity", async () => {
    vi.mocked(Secrets.getAll).mockReturnValue(["key"]);
    mockProviderClass.buildModelsRequest.mockRejectedValue(
      new ProviderNotSupportedError("unsupported"),
    );

    const response = await handleStatusRequest();
    const body = await response.json();

    expect(body.providers.openai.keys[0].status).toBe("unknown");
  });

  it("treats timed out connectivity checks as unknown", async () => {
    const timeoutError = new Error("timed out");
    timeoutError.name = "TimeoutError";
    vi.mocked(Secrets.getAll).mockReturnValue(["key"]);
    vi.mocked(withTimeout).mockRejectedValue(timeoutError);

    const response = await handleStatusRequest();
    const body = await response.json();

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
    mockProviderClass.buildModelsRequest.mockRejectedValue(error);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const response = await handleStatusRequest();
    const body = await response.json();

    expect(body.providers.openai.keys[0].status).toBe("invalid");
    expect(consoleError).toHaveBeenCalledWith({
      event: "provider.connectivity.failed",
      request_id: null,
      provider: "openai",
      error_name: "Error",
      error_message: "network unavailable",
    });
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
    const body = await response.json();

    expect(body.providers.openai.keys.map((key: any) => key.status)).toEqual([
      "valid",
      "invalid",
      "unknown",
    ]);
    expect(gateway.buildProviderEndpointRequest).toHaveBeenCalledTimes(3);
    expect(mockProviderClass.fetch).not.toHaveBeenCalled();
    expect(fetchWithLogging).toHaveBeenCalledWith(
      "https://gateway.example/models",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("uses direct connectivity when Gateway model discovery is unsupported", async () => {
    vi.mocked(Secrets.getAll).mockReturnValue(["key"]);
    mockProviderClass.supportsAiGatewayModels = false;
    mockProviderClass.fetch.mockResolvedValue(
      new Response(null, { status: 200 }),
    );
    const gateway = {
      buildProviderEndpointRequest: vi.fn(),
    } as any;

    const body = await (await handleStatusRequest(gateway)).json();

    expect(body.providers.openai.keys[0].status).toBe("valid");
    expect(mockProviderClass.fetch).toHaveBeenCalledOnce();
    expect(gateway.buildProviderEndpointRequest).not.toHaveBeenCalled();
    expect(fetchWithLogging).not.toHaveBeenCalled();
  });

  it("reports unknown when neither Gateway nor direct model discovery is supported", async () => {
    vi.mocked(Secrets.getAll).mockReturnValue(["key"]);
    mockProviderClass.supportsAiGatewayModels = false;
    mockProviderClass.buildModelsRequest.mockRejectedValue(
      new ProviderNotSupportedError("unsupported"),
    );
    const gateway = {
      buildProviderEndpointRequest: vi.fn(),
    } as any;

    const body = await (await handleStatusRequest(gateway)).json();

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
      apiKeyName: "FIRST_API_KEY",
      available: vi.fn().mockReturnValue(true),
      buildModelsRequest: vi.fn().mockResolvedValue(["/models", {}]),
      fetch: vi.fn().mockReturnValue(firstResponse),
    };
    const second = {
      ...mockProviderClass,
      apiKeyName: "SECOND_API_KEY",
      available: vi.fn().mockReturnValue(true),
      buildModelsRequest: vi.fn().mockResolvedValue(["/models", {}]),
      fetch: vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
    };
    vi.mocked(getAllProviderInstances).mockReturnValue({
      first,
      second,
    } as any);
    vi.mocked(Secrets.getAll).mockReturnValue(["key"]);

    const statusPromise = handleStatusRequest();
    await vi.waitFor(() => expect(second.fetch).toHaveBeenCalledOnce());
    releaseFirst(new Response(null, { status: 200 }));

    const body = await (await statusPromise).json();
    expect(Object.keys(body.providers)).toEqual(["first", "second"]);
  });

  it("caps live connectivity fan-out and leaves excess slots unknown", async () => {
    vi.mocked(Secrets.getAll).mockReturnValue(
      Array.from(
        { length: MAX_STATUS_CONNECTIVITY_CHECKS + 2 },
        (_, index) => `key-${index}`,
      ),
    );
    mockProviderClass.fetch.mockImplementation(
      async () => new Response(null, { status: 200 }),
    );

    const body = await (await handleStatusRequest()).json();
    expect(mockProviderClass.fetch).toHaveBeenCalledTimes(
      MAX_STATUS_CONNECTIVITY_CHECKS,
    );
    expect(body.providers.openai.keys.at(-1)).toEqual({
      slot: MAX_STATUS_CONNECTIVITY_CHECKS + 1,
      status: "unknown",
    });
  });

  it("cancels diagnostic response bodies after classifying headers", async () => {
    vi.mocked(Secrets.getAll).mockReturnValue(["key"]);
    const upstreamResponse = new Response("unused", { status: 200 });
    const cancel = vi.spyOn(upstreamResponse.body!, "cancel");
    mockProviderClass.fetch.mockResolvedValue(upstreamResponse);

    await handleStatusRequest();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("keeps the classified status when response-body cancellation fails", async () => {
    vi.mocked(Secrets.getAll).mockReturnValue(["key"]);
    const upstreamResponse = new Response("unused", { status: 200 });
    vi.spyOn(upstreamResponse.body!, "cancel").mockRejectedValue(
      new Error("already locked"),
    );
    mockProviderClass.fetch.mockResolvedValue(upstreamResponse);

    const body = await (await handleStatusRequest()).json();
    expect(body.providers.openai.keys[0].status).toBe("valid");
  });
});
