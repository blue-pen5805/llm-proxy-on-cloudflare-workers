import { describe, it, expect, vi, beforeEach } from "vitest";
import { EndpointBase } from "~/src/providers/endpoint";
import * as utils from "~/src/utils";

vi.mock("~/src/utils", () => ({
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
    it("should return empty object by default", () => {
      expect(endpoint.headers()).toEqual({});
    });
  });

  describe("requestData", () => {
    it("should construct proper request data", () => {
      const pathname = "/test/path";
      const init = {
        method: "POST",
        headers: { "X-Custom-Header": "value" },
        body: JSON.stringify({ test: "data" }),
      };

      const result = endpoint.requestData(pathname, init);

      expect(result).toEqual([
        "https://example.com/test/path",
        {
          ...init,
          headers: {
            ...init.headers,
            ...endpoint.headers(),
          },
        },
      ]);
    });

    it("should combine custom headers with endpoint headers", () => {
      vi.spyOn(endpoint, "headers").mockReturnValue({
        "Content-Type": "application/json",
      });

      const init = { headers: { Authorization: "Bearer token" } };
      const [_, resultInit = {}] = endpoint.requestData("/test", init);

      expect(resultInit.headers).toEqual({
        Authorization: "Bearer token",
        "Content-Type": "application/json",
      });
    });

    it("should include pathname prefix", () => {
      vi.spyOn(endpoint, "pathnamePrefix").mockReturnValue("/prefix");

      const [url] = endpoint.requestData("/test");

      expect(url).toBe("https://example.com/prefix/test");
    });
  });

  describe("fetch", () => {
    it("should call fetch2 with correct parameters", async () => {
      const pathname = "/test";
      const init = { method: "GET" };
      const requestDataResult = [
        "https://example.com/test",
        { method: "GET", headers: {} },
      ] as Parameters<typeof fetch>;

      vi.spyOn(endpoint, "requestData").mockReturnValue(requestDataResult);

      await endpoint.fetch(pathname, init);

      expect(endpoint.requestData).toHaveBeenCalledWith(pathname, init);
      expect(fetch2).toHaveBeenCalledWith(...requestDataResult);
    });
  });
});
