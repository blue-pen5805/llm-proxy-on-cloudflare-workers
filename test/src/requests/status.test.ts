import { describe, it, expect, vi, beforeEach } from "vitest";
import { CloudflareAIGateway } from "~/src/ai_gateway";
import { Providers } from "~/src/providers";
import { getAllProviders } from "~/src/providers";
import { CustomOpenAI } from "~/src/providers/custom-openai";
import { ProviderNotSupportedError } from "~/src/providers/provider";
import { status } from "~/src/requests/status";
import { Config } from "~/src/utils/config";
import { Environments } from "~/src/utils/environments";
import { fetch2 } from "~/src/utils/helpers";
import { Secrets } from "~/src/utils/secrets";

vi.mock("~/src/providers", async () => {
  const actual =
    await vi.importActual<typeof import("~/src/providers")>("~/src/providers");
  return {
    ...actual,
    getAllProviders: vi.fn(),
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
    available: vi.fn(),
    buildModelsRequest: vi.fn(),
    fetch: vi.fn(),
    headers: vi.fn().mockResolvedValue({ Authorization: "Bearer key" }),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Clear Providers object
    Object.keys(Providers).forEach((key) => {
      delete Providers[key];
    });

    vi.mocked(Config.isDevelopment).mockReturnValue(false);
    vi.mocked(Config.defaultModel).mockReturnValue("gpt-4");
    vi.mocked(Config.aiGateway).mockReturnValue({
      accountId: "acc-123",
      name: "gw-123",
      token: "tok-123",
    });
    vi.mocked(Config.isGlobalRoundRobinEnabled).mockReturnValue(true);

    vi.mocked(Environments.getEnv).mockReturnValue({} as Env);
    vi.mocked(Environments.all).mockReturnValue({} as any);

    Providers.openai = vi.fn(function () {
      const instance = Object.create(mockProviderClass);
      instance.apiKeyName = "OPENAI_API_KEY";
      return instance;
    });

    vi.mocked(getAllProviders).mockImplementation(() => {
      return Object.fromEntries(
        Object.keys(Providers).map((key) => [
          key,
          new (Providers[key] as any)(),
        ]),
      );
    });

    mockProviderClass.available.mockReturnValue(true);
    mockProviderClass.buildModelsRequest.mockReturnValue([
      "/models",
      { method: "GET" },
    ]);
  });

  it("should return structured JSON with config and provider status", async () => {
    vi.mocked(Secrets.getAll).mockReturnValue(["sk-123456789", "sk-abcdefghi"]);
    mockProviderClass.fetch.mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    const response = await status();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");

    const body = (await response.json()) as any;
    expect(body.config).toEqual({
      DEV: false,
      DEFAULT_MODEL: "gpt-4",
      AI_GATEWAY: {
        accountId: "acc-123",
        name: "gw-123",
        token: "tok-123",
      },
      GLOBAL_ROUND_ROBIN: true,
    });

    expect(body.providers.openai).toBeDefined();
    expect(body.providers.openai.available).toBe(true);
    expect(body.providers.openai.keys).toHaveLength(2);
    expect(body.providers.openai.keys[0]).toEqual({
      key: "*********789",
      status: "valid",
    });
    expect(body.providers.openai.keys[1]).toEqual({
      key: "*********ghi",
      status: "valid",
    });
  });

  it("should handle invalid API keys", async () => {
    vi.mocked(Secrets.getAll).mockReturnValue(["invalid-key"]);
    mockProviderClass.fetch.mockResolvedValue(
      new Response(null, { status: 401 }),
    );

    const response = await status();
    const body = (await response.json()) as any;

    expect(body.providers.openai.keys[0].status).toBe("invalid");
  });

  it("should handle unknown status for other error codes", async () => {
    vi.mocked(Secrets.getAll).mockReturnValue(["unknown-key"]);
    mockProviderClass.fetch.mockResolvedValue(
      new Response(null, { status: 500 }),
    );

    const response = await status();
    const body = (await response.json()) as any;

    expect(body.providers.openai.keys[0].status).toBe("unknown");
  });

  it("should handle providers without API keys", async () => {
    Providers.nokeys = vi.fn(function () {
      return {
        apiKeyName: undefined,
        available: vi.fn().mockReturnValue(true),
      };
    });

    const response = await status();
    const body = (await response.json()) as any;

    expect(body.providers.nokeys).toEqual({
      available: true,
      keys: [],
    });
  });

  it("should mask long and short keys correctly", async () => {
    vi.mocked(Secrets.getAll).mockReturnValue([
      "short",
      "longest-key-ever-123",
    ]);
    mockProviderClass.fetch.mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    const response = await status();
    const body = (await response.json()) as any;

    expect(body.providers.openai.keys[0].key).toBe("**ort"); // Math.min(10, 5-3) = 2 stars
    expect(body.providers.openai.keys[1].key).toBe("**********123"); // max 10 stars
  });

  it("should skip connectivity check when modelsPath is missing", async () => {
    Providers.skip = vi.fn(function () {
      return {
        apiKeyName: "SKIP_API_KEY",
        modelsPath: "",
        available: vi.fn().mockReturnValue(true),
      };
    });
    vi.mocked(Secrets.getAll).mockReturnValue(["any-key"]);

    const response = await status();
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
    vi.mocked(getAllProviders).mockReturnValue({ custom });
    vi.mocked(Config.defaultModel).mockReturnValue(undefined);

    const response = await status();
    const body = await response.json();

    expect(body.config.DEFAULT_MODEL).toBeNull();
    expect(body.providers.custom.keys).toEqual([
      { key: "***", status: "valid" },
      { key: "***", status: "valid" },
    ]);
    expect(Secrets.getAll).not.toHaveBeenCalled();
  });

  it("treats unsupported model listing as unknown connectivity", async () => {
    vi.mocked(Secrets.getAll).mockReturnValue(["key"]);
    mockProviderClass.buildModelsRequest.mockRejectedValue(
      new ProviderNotSupportedError("unsupported"),
    );

    const response = await status();
    const body = await response.json();

    expect(body.providers.openai.keys[0].status).toBe("unknown");
  });

  it("reports unexpected connectivity failures as invalid", async () => {
    const error = new Error("network unavailable");
    vi.mocked(Secrets.getAll).mockReturnValue(["key"]);
    mockProviderClass.buildModelsRequest.mockRejectedValue(error);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const response = await status();
    const body = await response.json();

    expect(body.providers.openai.keys[0].status).toBe("invalid");
    expect(consoleError).toHaveBeenCalledWith(
      "Error checking connectivity for openai:",
      error,
    );
  });

  it("checks supported providers through AI Gateway", async () => {
    vi.mocked(Secrets.getAll).mockReturnValue(["valid", "invalid", "unknown"]);
    vi.spyOn(CloudflareAIGateway, "isSupportedProvider").mockReturnValue(true);
    vi.mocked(fetch2)
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));
    const gateway = {
      buildProviderEndpointRequest: vi
        .fn()
        .mockReturnValue(["https://gateway.example/models", { method: "GET" }]),
    } as any;

    const response = await status(gateway);
    const body = await response.json();

    expect(body.providers.openai.keys.map((key: any) => key.status)).toEqual([
      "valid",
      "invalid",
      "unknown",
    ]);
    expect(gateway.buildProviderEndpointRequest).toHaveBeenCalledTimes(3);
    expect(mockProviderClass.fetch).not.toHaveBeenCalled();
  });
});
