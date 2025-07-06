import { describe, it, expect } from "vitest";
import { handleOptions } from "~/src/requests/options";

describe("handleOptions", () => {
  it("should handle preflight CORS request", async () => {
    const request = new Request("https://example.com", {
      method: "OPTIONS",
      headers: {
        Origin: "https://example.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,authorization",
      },
    });

    const response = await handleOptions(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
      "GET,HEAD,POST,OPTIONS",
    );
    expect(response.headers.get("Access-Control-Max-Age")).toBe("86400");
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
      "content-type,authorization",
    );
  });

  it("should handle standard OPTIONS request", async () => {
    const request = new Request("https://example.com", {
      method: "OPTIONS",
      headers: {},
    });

    const response = await handleOptions(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("Allow")).toBe("GET, HEAD, POST, OPTIONS");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(response.headers.get("Access-Control-Allow-Methods")).toBeNull();
  });

  it("should handle OPTIONS request with Origin but no other CORS headers", async () => {
    const request = new Request("https://example.com", {
      method: "OPTIONS",
      headers: {
        Origin: "https://example.com",
      },
    });

    const response = await handleOptions(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("Allow")).toBe("GET, HEAD, POST, OPTIONS");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("should handle OPTIONS request with Access-Control-Request-Method but no Origin", async () => {
    const request = new Request("https://example.com", {
      method: "OPTIONS",
      headers: {
        "Access-Control-Request-Method": "POST",
      },
    });

    const response = await handleOptions(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("Allow")).toBe("GET, HEAD, POST, OPTIONS");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("should handle preflight CORS request with different requested headers", async () => {
    const request = new Request("https://example.com", {
      method: "OPTIONS",
      headers: {
        Origin: "https://example.com",
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "x-custom-header,user-agent",
      },
    });

    const response = await handleOptions(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
      "GET,HEAD,POST,OPTIONS",
    );
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
      "x-custom-header,user-agent",
    );
  });

  it("should return body as null for all OPTIONS requests", async () => {
    const request = new Request("https://example.com", {
      method: "OPTIONS",
      headers: {
        Origin: "https://example.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });

    const response = await handleOptions(request);
    const body = await response.text();

    expect(body).toBe("");
  });
});
