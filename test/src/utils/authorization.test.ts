import { describe, it, expect, beforeEach, vi } from "vitest";
import { authenticate } from "~/src/utils/authorization";
import { Config } from "~/src/utils/config";

vi.mock("~/src/utils/config");

describe("authenticate", () => {
  // Mock the Config.apiKeys method to return a valid API key
  beforeEach(() => {
    vi.mocked(Config.apiKeys).mockReturnValue(["valid-key"]);
  });

  // Test when no API key is set in the environment
  it("should return true when no PROXY_API_KEY is set", () => {
    vi.mocked(Config.apiKeys).mockReturnValue(undefined);
    const request = new Request("https://example.com");

    expect(authenticate(request)).toBe(true);
  });

  // Test when API key is set and authentication succeeds with Authorization header
  it("should return true when valid Authorization header is provided", () => {
    const request = new Request("https://example.com", {
      headers: {
        Authorization: "Bearer valid-key",
      },
    });

    expect(authenticate(request)).toBe(true);
  });

  // Test when API key is set and authentication succeeds with x-api-key header
  it("should return true when valid x-api-key header is provided", () => {
    const request = new Request("https://example.com", {
      headers: {
        "x-api-key": "valid-key",
      },
    });

    expect(authenticate(request)).toBe(true);
  });

  // Test when API key is set and authentication succeeds with x-goog-api-key header
  it("should return true when valid x-goog-api-key header is provided", () => {
    const request = new Request("https://example.com", {
      headers: {
        "x-goog-api-key": "valid-key",
      },
    });

    expect(authenticate(request)).toBe(true);
  });

  // Test when API key is set and authentication succeeds with query parameter 'key'
  it("should return true when valid 'key' query parameter is provided", () => {
    const request = new Request("https://example.com?key=valid-key");

    expect(authenticate(request)).toBe(true);
  });

  // Test when authentication fails due to missing headers
  it("should return false when no authorization header or query key is provided", () => {
    const request = new Request("https://example.com");

    expect(authenticate(request)).toBe(false);
  });

  // Test when authentication fails due to incorrect API key
  it("should return false when invalid API key is provided", () => {
    const request = new Request("https://example.com", {
      headers: {
        Authorization: "Bearer invalid-key",
      },
    });

    expect(authenticate(request)).toBe(false);
  });
});
