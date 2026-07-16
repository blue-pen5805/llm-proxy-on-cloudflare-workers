import { describe, it, expect, vi, beforeEach } from "vitest";
import { CloudflareAIGateway } from "~/src/ai_gateway";
import { Providers } from "~/src/providers";
import { getProvider } from "~/src/providers";
import { proxy } from "~/src/requests/proxy";
import { Environments } from "~/src/utils/environments";
import { NotFoundError } from "~/src/utils/error";
import { fetch2 } from "~/src/utils/helpers";
import { Secrets } from "~/src/utils/secrets";

vi.mock("~/src/providers", async () => {
  const actual =
    await vi.importActual<typeof import("~/src/providers")>("~/src/providers");
  return {
    ...actual,
    getProvider: vi.fn(),
  };
});
vi.mock("~/src/providers/ai_gateway");
vi.mock("~/src/utils/helpers");
vi.mock("~/src/utils/environments");
vi.mock("~/src/utils/secrets");

describe("proxy", () => {
  const mockProviderClass = {
    endpoint: {
      baseUrl: vi.fn().mockReturnValue("https://api.example.com/test"),
    },
    fetch: vi.fn(),
    getApiKeys: vi.fn().mockReturnValue(["test-key"]),
    getNextApiKeyIndex: vi.fn().mockResolvedValue(0),
    headers: vi.fn().mockResolvedValue({ Authorization: "Bearer test-key" }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Secrets.getAll).mockReturnValue(["test-key"]);
    vi.mocked(Secrets.getNext).mockResolvedValue(0);
    vi.mocked(Environments.all).mockReturnValue({} as any);

    vi.mocked(getProvider).mockImplementation((name) => {
      const ProviderClass = Providers[name];
      return ProviderClass ? new (ProviderClass as any)() : undefined;
    });
  });

  it("should call providerClass.fetch with correct arguments", async () => {
    const providerName = "testProvider";
    Providers[providerName] = vi.fn(function () {
      return mockProviderClass;
    });

    const mockRequest = new Request("https://example.com/test/path", {
      method: "GET",
      body: null,
      headers: new Headers(),
    });

    await proxy({ request: mockRequest } as any, providerName, "/test/path");

    expect(mockProviderClass.fetch).toHaveBeenCalledWith(
      "/test/path",
      {
        method: mockRequest.method,
        body: mockRequest.body,
        headers: mockRequest.headers,
      },
      0,
    );
  });

  it("should handle duplicate path segments correctly", async () => {
    const providerName = "testProvider";
    Providers[providerName] = vi.fn(function () {
      return mockProviderClass;
    });

    const mockRequest = new Request("https://example.com/test/test/path", {
      method: "GET",
      body: null,
      headers: new Headers(),
    });

    await proxy({ request: mockRequest } as any, providerName, "/test/path");

    expect(mockProviderClass.fetch).toHaveBeenCalledWith(
      "/test/path",
      {
        method: mockRequest.method,
        body: mockRequest.body,
        headers: mockRequest.headers,
      },
      0,
    );
  });

  it("throws NotFoundError for an unknown provider", async () => {
    vi.mocked(getProvider).mockReturnValue(undefined);
    const request = new Request("https://example.com/missing");

    await expect(
      proxy({ request } as any, "missing", "/missing"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("resolves an explicit key selection from middleware context", async () => {
    const providerName = "selectedProvider";
    Providers[providerName] = vi.fn(function () {
      return mockProviderClass;
    });
    vi.mocked(Secrets.resolveApiKeyIndex).mockReturnValue(2);
    const request = new Request("https://example.com/models");

    await proxy(
      { request, apiKeyIndex: { start: 1, end: 2 } } as any,
      providerName,
      "/models",
    );

    expect(Secrets.resolveApiKeyIndex).toHaveBeenCalledWith(
      { start: 1, end: 2 },
      1,
    );
    expect(mockProviderClass.getNextApiKeyIndex).not.toHaveBeenCalled();
    expect(mockProviderClass.fetch).toHaveBeenCalledWith(
      "/models",
      expect.any(Object),
      2,
    );
  });

  it("routes supported providers through AI Gateway", async () => {
    const providerName = "openai";
    Providers[providerName] = vi.fn(function () {
      return mockProviderClass;
    });
    vi.spyOn(CloudflareAIGateway, "isSupportedProvider").mockReturnValue(true);
    const buildProviderEndpointRequest = vi
      .fn()
      .mockReturnValue([
        "https://gateway.example/openai/models",
        { method: "GET" },
      ]);
    const gateway = { buildProviderEndpointRequest } as any;
    vi.mocked(fetch2).mockResolvedValue(new Response("gateway"));
    const request = new Request("https://example.com/models", {
      headers: { "X-Request": "value" },
    });

    const response = await proxy(
      { request } as any,
      providerName,
      "/models",
      gateway,
    );

    expect(buildProviderEndpointRequest).toHaveBeenCalledWith({
      provider: "openai",
      method: "GET",
      path: "/models",
      body: request.body,
      headers: expect.objectContaining({
        Authorization: "Bearer test-key",
      }),
    });
    expect(fetch2).toHaveBeenCalledWith(
      "https://gateway.example/openai/models",
      { method: "GET" },
    );
    expect(await response.text()).toBe("gateway");
  });
});
