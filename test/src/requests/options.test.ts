import { afterEach, describe, it, expect, vi } from "vitest";
import { addCorsHeaders, handleOptions } from "~/src/requests/options";
import { Config } from "~/src/utils/config";

afterEach(() => vi.restoreAllMocks());

describe("Vary", () => {
  it("marks a preflight response as varying by its CORS request headers", async () => {
    const response = await handleOptions(
      new Request("https://example.com", {
        method: "OPTIONS",
        headers: {
          Origin: "https://example.com",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "authorization",
        },
      }),
    );

    expect(response.headers.get("Vary")).toBe(
      "Origin, Access-Control-Request-Headers",
    );
  });

  it("marks a preflight response without requested headers as varying by Origin", async () => {
    const response = await handleOptions(
      new Request("https://example.com", {
        method: "OPTIONS",
        headers: {
          Origin: "https://example.com",
          "Access-Control-Request-Method": "POST",
        },
      }),
    );

    expect(response.headers.get("Vary")).toBe("Origin");
  });

  it("appends Origin to an upstream Vary on a cross-origin response", () => {
    const response = addCorsHeaders(
      new Request("https://example.com", {
        headers: { Origin: "https://example.com" },
      }),
      new Response("ok", { headers: { Vary: "Accept-Encoding" } }),
    );

    expect(response.headers.get("Vary")).toBe("Accept-Encoding, Origin");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Expose-Headers")).toBe(
      "X-Proxy-Models-Cache,X-Proxy-Models-Truncated",
    );
  });

  it("leaves a same-origin response untouched", () => {
    const upstream = new Response("ok");

    expect(addCorsHeaders(new Request("https://example.com"), upstream)).toBe(
      upstream,
    );
  });
});

describe("handleOptions", () => {
  it("reflects only an explicitly allowed origin", async () => {
    vi.spyOn(Config, "allowedOrigins").mockReturnValue([
      "https://allowed.example",
    ]);
    const allowed = await handleOptions(
      new Request("https://proxy.example", {
        method: "OPTIONS",
        headers: {
          Origin: "https://allowed.example",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "authorization",
        },
      }),
    );
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://allowed.example",
    );

    const denied = await handleOptions(
      new Request("https://proxy.example", {
        method: "OPTIONS",
        headers: {
          Origin: "https://denied.example",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "authorization",
        },
      }),
    );
    expect(denied.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(denied.headers.get("Access-Control-Allow-Headers")).toBeNull();

    const deniedActual = addCorsHeaders(
      new Request("https://proxy.example", {
        headers: { Origin: "https://denied.example" },
      }),
      new Response("denied"),
    );
    expect(deniedActual.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(
      deniedActual.headers.get("Access-Control-Expose-Headers"),
    ).toBeNull();
  });

  it("keeps an error response safe when origin configuration is invalid", () => {
    vi.spyOn(Config, "allowedOrigins").mockImplementation(() => {
      throw new Error("invalid configuration");
    });
    const response = addCorsHeaders(
      new Request("https://proxy.example", {
        headers: { Origin: "https://app.example" },
      }),
      new Response("error", {
        status: 503,
        headers: { "Access-Control-Allow-Origin": "*" },
      }),
    );
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

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
    expect(await response.text()).toBe("");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
      "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
    );
    expect(response.headers.get("Access-Control-Max-Age")).toBe("86400");
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
      "content-type,authorization",
    );
  });

  // A preflight needs both an Origin and a requested method; anything else is
  // answered as a plain OPTIONS request.
  it.each([
    ["no CORS headers", {}],
    ["only an Origin", { Origin: "https://example.com" }],
    ["only a requested method", { "Access-Control-Request-Method": "POST" }],
  ])("should handle an OPTIONS request with %s", async (_name, headers) => {
    const response = await handleOptions(
      new Request("https://example.com", { method: "OPTIONS", headers }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Allow")).toBe(
      "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
    );
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(response.headers.get("Access-Control-Allow-Methods")).toBeNull();
  });

  it("should handle preflight without requested headers", async () => {
    const request = new Request("https://example.com", {
      method: "OPTIONS",
      headers: {
        Origin: "https://client.example",
        "Access-Control-Request-Method": "POST",
      },
    });

    const response = await handleOptions(request);

    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Headers")).toBeNull();
  });
});
