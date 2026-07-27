import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getAuthorizedProxyKeyIndex,
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

  it("reuses cached configured-key digests across repeated requests", () => {
    const request = new Request("https://example.com", {
      headers: {
        Authorization: "Bearer valid-key",
      },
    });

    expect(isRequestAuthorized(request)).toBe(true);
    expect(isRequestAuthorized(request)).toBe(true);
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

  it("returns the matching configured slot without exposing key material", () => {
    const request = new Request("https://example.com", {
      headers: { Authorization: "Bearer second-key" },
    });
    expect(
      getAuthorizedProxyKeyIndex(request, ["first-key", "second-key"]),
    ).toBe(1);
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

  it("rejects query-string credentials", () => {
    const request = new Request("https://example.com?key=valid-key");

    expect(isRequestAuthorized(request)).toBe(false);
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
      "cf-aig-byok-alias": "privileged-key",
      "cf-aig-max-attempts": "5",
      "api-key": "attacker-azure-key",
      cookie: "session=private",
      "x-forwarded-for": "203.0.113.1",
      "true-client-ip": "203.0.113.2",
      "x-client-header": "preserved",
    });

    const sanitized = stripProxyAuthorizationHeaders(original);

    expect(sanitized.has("Authorization")).toBe(false);
    expect(sanitized.has("x-api-key")).toBe(false);
    expect(sanitized.has("x-goog-api-key")).toBe(false);
    expect(sanitized.has("cf-aig-authorization")).toBe(false);
    expect(sanitized.has("cf-aig-byok-alias")).toBe(false);
    expect(sanitized.has("cf-aig-max-attempts")).toBe(false);
    expect(sanitized.has("api-key")).toBe(false);
    expect(sanitized.has("cookie")).toBe(false);
    expect(sanitized.has("x-forwarded-for")).toBe(false);
    expect(sanitized.has("true-client-ip")).toBe(false);
    expect(sanitized.get("x-client-header")).toBe("preserved");
    expect(original.get("Authorization")).toBe("Bearer proxy-secret");
  });

  it("preserves request-level AI Gateway headers only when requested", () => {
    const sanitized = stripProxyAuthorizationHeaders(
      {
        "cf-aig-authorization": "Bearer client-gateway-token",
        "cf-aig-byok-alias": "privileged-key",
        "cf-aig-max-attempts": "3",
        "cf-aig-metadata": '{"tenant":"example"}',
        "cf-connecting-ip": "203.0.113.1",
        "x-forwarded-for": "203.0.113.1",
      },
      { preserveAiGatewayHeaders: true },
    );

    expect(sanitized.has("cf-aig-authorization")).toBe(false);
    expect(sanitized.has("cf-aig-byok-alias")).toBe(false);
    expect(sanitized.get("cf-aig-max-attempts")).toBe("3");
    expect(sanitized.get("cf-aig-metadata")).toBe('{"tenant":"example"}');
    expect(sanitized.has("cf-connecting-ip")).toBe(false);
    expect(sanitized.has("x-forwarded-for")).toBe(false);
  });

  it("never preserves the client-supplied Gateway cache key", () => {
    const sanitized = stripProxyAuthorizationHeaders(
      {
        "cf-aig-cache-key": "shared-tenant-key",
        "cf-aig-max-attempts": "3",
      },
      { preserveAiGatewayHeaders: true },
    );

    expect(sanitized.has("cf-aig-cache-key")).toBe(false);
    expect(sanitized.get("cf-aig-max-attempts")).toBe("3");
  });
});
