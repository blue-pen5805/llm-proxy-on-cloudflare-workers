import { describe, it, expect } from "vitest";
import { authenticate } from "../src/authorization";

describe("authenticate", () => {
  // Test when no API key is set in the environment
  it("should return true when no PROXY_API_KEY is set", () => {
    const request = new Request("https://example.com");
    const env = {} as Env;
    expect(authenticate(request, env)).toBe(true);
  });

  // Test when API key is set and authentication succeeds with Authorization header
  it("should return true when valid Authorization header is provided", () => {
    const request = new Request("https://example.com", {
      headers: {
        Authorization: "Bearer valid-key",
      },
    });
    const env = {
      PROXY_API_KEY: "valid-key",
    } as Env;
    expect(authenticate(request, env)).toBe(true);
  });

  // Test when API key is set and authentication succeeds with x-api-key header
  it("should return true when valid x-api-key header is provided", () => {
    const request = new Request("https://example.com", {
      headers: {
        "x-api-key": "valid-key",
      },
    });
    const env = {
      PROXY_API_KEY: "valid-key",
    } as Env;
    expect(authenticate(request, env)).toBe(true);
  });

  // Test when API key is set and authentication succeeds with x-goog-api-key header
  it("should return true when valid x-goog-api-key header is provided", () => {
    const request = new Request("https://example.com", {
      headers: {
        "x-goog-api-key": "valid-key",
      },
    });
    const env = {
      PROXY_API_KEY: "valid-key",
    } as Env;
    expect(authenticate(request, env)).toBe(true);
  });

  // Test when authentication fails due to missing headers
  it("should return false when no authorization header is provided", () => {
    const request = new Request("https://example.com");
    const env = {
      PROXY_API_KEY: "valid-key",
    } as Env;
    expect(authenticate(request, env)).toBe(false);
  });

  // Test when authentication fails due to incorrect API key
  it("should return false when invalid API key is provided", () => {
    const request = new Request("https://example.com", {
      headers: {
        Authorization: "Bearer invalid-key",
      },
    });
    const env = {
      PROXY_API_KEY: "valid-key",
    } as Env;
    expect(authenticate(request, env)).toBe(false);
  });

  // Test case with Authorization header in format "Bearer token"
  it("should handle Authorization header with Bearer prefix", () => {
    const request = new Request("https://example.com", {
      headers: {
        Authorization: "Bearer valid-key",
      },
    });
    const env = {
      PROXY_API_KEY: "valid-key",
    } as Env;
    expect(authenticate(request, env)).toBe(true);
  });

  // Test case with plain token in header without Bearer prefix
  it("should handle Authorization header without Bearer prefix", () => {
    const request = new Request("https://example.com", {
      headers: {
        Authorization: "valid-key",
      },
    });
    const env = {
      PROXY_API_KEY: "valid-key",
    } as Env;
    expect(authenticate(request, env)).toBe(true);
  });
});
