import { describe, it, expect, vi, beforeEach } from "vitest";
import { EndpointBase } from "~/src/providers/endpoint";
import { ProviderBase } from "~/src/providers/provider";

vi.mock("~/src/utils", () => ({
  fetch2: vi.fn().mockImplementation(() => Promise.resolve(new Response())),
}));

describe("ProviderBase", () => {
  let providerBase: ProviderBase;
  let mockEndpoint: EndpointBase;

  beforeEach(() => {
    // Create a mock endpoint
    mockEndpoint = {
      available: vi.fn().mockReturnValue(true),
      baseUrl: vi.fn().mockReturnValue("https://api.example.com"),
      pathnamePrefix: vi.fn().mockReturnValue(""),
      headers: vi.fn().mockReturnValue({ "Content-Type": "application/json" }),
      fetch: vi.fn().mockResolvedValue(new Response()),
      requestData: vi.fn().mockReturnValue([
        "https://api.example.com/test",
        {
          headers: { "Content-Type": "application/json" },
          method: "GET",
        },
      ]),
    } as unknown as EndpointBase;

    // Initialize the provider base with mock endpoint
    providerBase = new ProviderBase();
    providerBase.endpoint = mockEndpoint;
  });

  describe("constructor", () => {
    it("should initialize", () => {
      expect(providerBase.endpoint).toBeDefined();
    });
  });

  describe("available", () => {
    it("should return endpoint availability", () => {
      const result = providerBase.available();
      expect(mockEndpoint.available).toHaveBeenCalled();
      expect(result).toBe(true);
    });
  });

  describe("fetch", () => {
    it("should call endpoint.fetch with correct parameters", async () => {
      await providerBase.fetch("/test", { method: "GET" });
      expect(mockEndpoint.fetch).toHaveBeenCalledWith(
        "/test",
        {
          method: "GET",
        },
        undefined,
      );
    });
  });
});
