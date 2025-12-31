import { describe, it, expect, vi, beforeEach } from "vitest";
import { Providers } from "~/src/providers";
import { getAllProviders } from "~/src/providers";
import { CustomOpenAI } from "~/src/providers/custom-openai";
import { status } from "~/src/requests/status";
import { Config } from "~/src/utils/config";
import { Environments } from "~/src/utils/environments";
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

describe("status", () => {
  const mockProviderClass = {
    apiKeyName: "OPENAI_API_KEY",
    modelsPath: "/models",
    available: vi.fn(),
    buildModelsRequest: vi.fn(),
    fetch: vi.fn(),
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

    Providers.openai = vi.fn().mockImplementation(() => {
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
    Providers.nokeys = vi.fn().mockImplementation(() => ({
      apiKeyName: undefined,
      available: vi.fn().mockReturnValue(true),
    }));

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
    Providers.skip = vi.fn().mockImplementation(() => ({
      apiKeyName: "SKIP_API_KEY",
      modelsPath: "",
      available: vi.fn().mockReturnValue(true),
    }));
    vi.mocked(Secrets.getAll).mockReturnValue(["any-key"]);

    const response = await status();
    const body = await response.json();

    expect(body.providers.skip.keys[0].status).toBe("unknown");
  });
});
