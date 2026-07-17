import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  isRequestAuthorized,
  stripProxyAuthorizationHeaders,
} from "~/src/utils/authorization";
import { Config } from "~/src/utils/config";

vi.mock("~/src/utils/config");

describe("isRequestAuthorized", () => {
  // Mock the Config.apiKeys method to return a valid API key
  beforeEach(() => {
    vi.mocked(Config.apiKeys).mockReturnValue(["valid-key"]);
  });

  // Test when no API key is set in the environment
  it("should return false when no PROXY_API_KEY is set", () => {
    vi.mocked(Config.apiKeys).mockReturnValue(undefined);
    const request = new Request("https://example.com");

    expect(isRequestAuthorized(request)).toBe(false);
  });

  // Test when API key is set and authentication succeeds with Authorization header
  it("should return true when valid Authorization header is provided", () => {
    const request = new Request("https://example.com", {
      headers: {
        Authorization: "Bearer valid-key",
      },
    });

    expect(isRequestAuthorized(request)).toBe(true);
  });

  it("should tolerate repeated whitespace in an Authorization header", () => {
    const request = new Request("https://example.com", {
      headers: {
        Authorization: "Bearer    valid-key",
      },
    });

    expect(isRequestAuthorized(request)).toBe(true);
  });

  it("rejects a non-Bearer authorization scheme", () => {
    const request = new Request("https://example.com", {
      headers: { Authorization: "Basic valid-key" },
    });
    expect(isRequestAuthorized(request)).toBe(false);
  });

  it("should isRequestAuthorized any configured key", () => {
    vi.mocked(Config.apiKeys).mockReturnValue(["first-key", "valid-key"]);
    const request = new Request("https://example.com", {
      headers: {
        Authorization: "Bearer valid-key",
      },
    });

    expect(isRequestAuthorized(request)).toBe(true);
  });

  // Test when API key is set and authentication succeeds with x-api-key header
  it("should return true when valid x-api-key header is provided", () => {
    const request = new Request("https://example.com", {
      headers: {
        "x-api-key": "valid-key",
      },
    });

    expect(isRequestAuthorized(request)).toBe(true);
  });

  // Test when API key is set and authentication succeeds with x-goog-api-key header
  it("should return true when valid x-goog-api-key header is provided", () => {
    const request = new Request("https://example.com", {
      headers: {
        "x-goog-api-key": "valid-key",
      },
    });

    expect(isRequestAuthorized(request)).toBe(true);
  });

  // Test when API key is set and authentication succeeds with query parameter 'key'
  it("should return true when valid 'key' query parameter is provided", () => {
    const request = new Request("https://example.com?key=valid-key");

    expect(isRequestAuthorized(request)).toBe(true);
  });

  // Test when authentication fails due to missing headers
  it("should return false when no authorization header or query key is provided", () => {
    const request = new Request("https://example.com");

    expect(isRequestAuthorized(request)).toBe(false);
  });

  // Test when authentication fails due to incorrect API key
  it("should return false when invalid API key is provided", () => {
    const request = new Request("https://example.com", {
      headers: {
        Authorization: "Bearer invalid-key",
      },
    });

    expect(isRequestAuthorized(request)).toBe(false);
  });
});

describe("stripProxyAuthorizationHeaders", () => {
  it("removes proxy credentials while preserving other headers", () => {
    const original = new Headers({
      Authorization: "Bearer proxy-secret",
      "x-api-key": "proxy-secret",
      "x-goog-api-key": "proxy-secret",
      "cf-aig-authorization": "Bearer attacker-token",
      "x-client-header": "preserved",
    });

    const sanitized = stripProxyAuthorizationHeaders(original);

    expect(sanitized.has("Authorization")).toBe(false);
    expect(sanitized.has("x-api-key")).toBe(false);
    expect(sanitized.has("x-goog-api-key")).toBe(false);
    expect(sanitized.has("cf-aig-authorization")).toBe(false);
    expect(sanitized.get("x-client-header")).toBe("preserved");
    expect(original.get("Authorization")).toBe("Bearer proxy-secret");
  });
});
