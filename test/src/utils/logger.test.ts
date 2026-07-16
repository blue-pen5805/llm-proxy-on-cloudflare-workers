import { afterEach, describe, expect, it, vi } from "vitest";
import { redactLogText, RequestLogger } from "~/src/utils/logger";

describe("RequestLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("adds the Cloudflare Ray ID and request fields to structured logs", () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const request = new Request("https://example.com/v1/models?key=secret", {
      method: "POST",
      headers: { "cf-ray": "ray-id" },
    });

    RequestLogger.run(request, () => {
      RequestLogger.info("test.event", { status: 200 });
      expect(RequestLogger.requestFields()).toEqual({
        method: "POST",
        path: "/v1/models",
      });
    });

    expect(consoleInfo).toHaveBeenCalledWith({
      event: "test.event",
      request_id: "ray-id",
      status: 200,
    });
  });

  it("generates a request ID when cf-ray is unavailable", () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});

    RequestLogger.run(new Request("https://example.com/"), () => {
      RequestLogger.info("test.event");
    });

    expect(consoleInfo).toHaveBeenCalledWith({
      event: "test.event",
      request_id: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      ),
    });
  });

  it("safely records errors without logging arbitrary thrown objects", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const thrown = { authorization: "Bearer private-value" };

    RequestLogger.error("test.failed", thrown, { provider: "test" });

    expect(consoleError).toHaveBeenCalledWith({
      event: "test.failed",
      request_id: null,
      provider: "test",
      error_name: "NonError",
      error_message: "Non-Error value thrown",
    });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      "private-value",
    );
  });

  it("redacts credentials and truncates long error messages", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const message =
      "Bearer secret https://example.com?api_key=private token=hidden " +
      "x".repeat(600);

    RequestLogger.error("test.failed", new TypeError(message));

    const record = consoleError.mock.calls[0][0] as Record<string, string>;
    expect(record.error_name).toBe("TypeError");
    expect(record.error_message).toContain("Bearer ***");
    expect(record.error_message).toContain("api_key=***");
    expect(record.error_message).toContain("token=***");
    expect(record.error_message).not.toContain("secret");
    expect(record.error_message).not.toContain("private");
    expect(record.error_message).not.toContain("hidden");
    expect(record.error_message).toHaveLength(501);
  });

  it("supports warning logs and ignores undefined fields", () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    RequestLogger.warn("test.warning", { provider: undefined });
    RequestLogger.warn("test.warning.default");

    expect(consoleWarn).toHaveBeenNthCalledWith(1, {
      event: "test.warning",
      request_id: null,
    });
    expect(consoleWarn).toHaveBeenNthCalledWith(2, {
      event: "test.warning.default",
      request_id: null,
    });
  });

  it("returns zero for request duration outside a request context", () => {
    expect(RequestLogger.requestDurationMs()).toBe(0);
    expect(RequestLogger.requestFields()).toEqual({
      method: undefined,
      path: undefined,
    });
  });

  it("scopes and overrides additional fields without leaking them", () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});

    RequestLogger.withFields({ provider: "openai", key_index: 1 }, () => {
      RequestLogger.info("outer");
      RequestLogger.withFields({ key_index: 2 }, () =>
        RequestLogger.info("inner"),
      );
    });
    RequestLogger.info("outside");

    expect(consoleInfo).toHaveBeenNthCalledWith(1, {
      provider: "openai",
      key_index: 1,
      event: "outer",
      request_id: null,
    });
    expect(consoleInfo).toHaveBeenNthCalledWith(2, {
      provider: "openai",
      key_index: 2,
      event: "inner",
      request_id: null,
    });
    expect(consoleInfo).toHaveBeenNthCalledWith(3, {
      event: "outside",
      request_id: null,
    });
  });
});

describe("redactLogText", () => {
  it("redacts sensitive URL and labeled values case-insensitively", () => {
    expect(
      redactLogText(
        "Authorization: abc, PASSWORD=hunter2&next=true /?access_token=value",
      ),
    ).toBe("Authorization: ***, PASSWORD=***&next=true /?access_token=***");
  });
});
