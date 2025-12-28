import { describe, it, expect, vi, beforeEach } from "vitest";
import { EndpointBase } from "~/src/providers/endpoint";
import * as utils from "~/src/utils/helpers";

vi.mock("~/src/utils/helpers", () => ({
  fetch2: vi.fn().mockImplementation(() => Promise.resolve(new Response())),
}));

describe("EndpointBase", () => {
  let endpoint: EndpointBase;
  const fetch2 = vi.mocked(utils.fetch2);

  beforeEach(() => {
    endpoint = new EndpointBase();
    fetch2.mockClear();
  });

  describe("available", () => {
    it("should return false by default", () => {
      expect(endpoint.available()).toBe(false);
    });
  });

  describe("baseUrl", () => {
    it("should return default URL", () => {
      expect(endpoint.baseUrl()).toBe("https://example.com");
    });
  });

  describe("pathnamePrefix", () => {
    it("should return empty string by default", () => {
      expect(endpoint.pathnamePrefix()).toBe("");
    });
  });

  describe("headers", () => {
    it("should return empty object by default", async () => {
      expect(await endpoint.headers()).toEqual({});
    });
  });

  describe("requestData", () => {
    it("should construct proper request data", async () => {
      const init = {
        method: "POST",
        headers: { "X-Custom-Header": "value" },
        body: JSON.stringify({ test: "data" }),
      };

      const result = await endpoint.requestData(init);

      expect(result).toEqual({
        ...init,
        headers: {
          ...init.headers,
          ...(await endpoint.headers()),
        },
      });
    });

    it("should combine custom headers with endpoint headers", async () => {
      vi.spyOn(endpoint, "headers").mockReturnValue(
        Promise.resolve({
          "Content-Type": "application/json",
        }),
      );

      const init = { headers: { Authorization: "Bearer token" } };
      const resultInit = await endpoint.requestData(init);

      expect(resultInit?.headers).toEqual({
        Authorization: "Bearer token",
        "Content-Type": "application/json",
      });
    });
  });

  describe("fetch", () => {
    it("should call fetch2 with correct parameters", async () => {
      const pathname = "/test";
      const init = { method: "GET" };
      const requestDataResult = { method: "GET", headers: {} } as Parameters<
        typeof fetch
      >[1];

      vi.spyOn(endpoint, "requestData").mockReturnValue(
        Promise.resolve(requestDataResult),
      );

      await endpoint.fetch(pathname, init);

      expect(endpoint.requestData).toHaveBeenCalledWith(init);
      expect(fetch2).toHaveBeenCalledWith(
        endpoint.baseUrl() + pathname,
        requestDataResult,
      );
    });
  });
});
