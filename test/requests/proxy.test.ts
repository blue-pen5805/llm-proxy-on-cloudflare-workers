import { describe, it, expect, vi, beforeEach } from "vitest";
import { proxy } from "../../src/requests/proxy";
import { Providers } from "../../src/providers";

vi.mock("../providers");
vi.mock("../providers/ai_gateway");
vi.mock("../utils");

describe("proxy", () => {
  const mockProviderClass = {
    endpoint: {
      baseUrl: vi.fn().mockReturnValue("https://api.example.com/test"),
    },
    fetch: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call providerClass.fetch with correct arguments", async () => {
    const providerName = "testProvider";
    Providers[providerName] = {
      providerClass: vi.fn().mockImplementation(() => mockProviderClass),
      args: {
        apiKey: "OPENAI_API_KEY",
      },
    };

    const mockRequest = new Request("https://example.com/test/path", {
      method: "GET",
      body: null,
      headers: new Headers(),
    });

    await proxy(mockRequest, providerName);

    expect(mockProviderClass.fetch).toHaveBeenCalledWith("/test/path", {
      method: mockRequest.method,
      body: mockRequest.body,
      headers: mockRequest.headers,
    });
  });

  it("should handle duplicate path segments correctly", async () => {
    const providerName = "testProvider";
    Providers[providerName] = {
      providerClass: vi.fn().mockImplementation(() => mockProviderClass),
      args: {
        apiKey: "OPENAI_API_KEY",
      },
    };

    const mockRequest = new Request("https://example.com/test/test/path", {
      method: "GET",
      body: null,
      headers: new Headers(),
    });

    await proxy(mockRequest, providerName);

    expect(mockProviderClass.fetch).toHaveBeenCalledWith("/test/path", {
      method: mockRequest.method,
      body: mockRequest.body,
      headers: mockRequest.headers,
    });
  });
});
