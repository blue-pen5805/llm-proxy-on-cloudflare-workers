import { describe, it, expect, vi, beforeEach } from "vitest";
import { Providers } from "~/src/providers";
import { proxy } from "~/src/requests/proxy";
import { Secrets } from "~/src/utils/secrets";

vi.mock("~/src/providers");
vi.mock("~/src/providers/ai_gateway");
vi.mock("~/src/utils/helpers");
vi.mock("~/src/utils/secrets");

describe("proxy", () => {
  const mockProviderClass = {
    endpoint: {
      baseUrl: vi.fn().mockReturnValue("https://api.example.com/test"),
    },
    fetch: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Secrets.getAll).mockReturnValue(["test-key"]);
    vi.mocked(Secrets.getNext).mockResolvedValue(0);
  });

  it("should call providerClass.fetch with correct arguments", async () => {
    const providerName = "testProvider";
    Providers[providerName] = vi
      .fn()
      .mockImplementation(() => mockProviderClass);

    const mockRequest = new Request("https://example.com/test/path", {
      method: "GET",
      body: null,
      headers: new Headers(),
    });

    await proxy(mockRequest, providerName, "/test/path");

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
    Providers[providerName] = vi
      .fn()
      .mockImplementation(() => mockProviderClass);

    const mockRequest = new Request("https://example.com/test/test/path", {
      method: "GET",
      body: null,
      headers: new Headers(),
    });

    await proxy(mockRequest, providerName, "/test/path");

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
});
