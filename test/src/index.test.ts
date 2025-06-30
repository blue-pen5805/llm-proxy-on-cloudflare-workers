import { SELF } from "cloudflare:test";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { chatCompletions } from "~/src/requests/chat_completions";
import { models } from "~/src/requests/models";
import { handleOptions } from "~/src/requests/options";
import { proxy } from "~/src/requests/proxy";
import { universalEndpoint } from "~/src/requests/universal_endpoint";
import { authenticate } from "~/src/utils/authorization";
import { Config } from "~/src/utils/config";

vi.mock("~/src/providers", () => ({
  Providers: {
    openai: {
      providerClass: vi.fn(),
    },
  },
}));

vi.mock("~/src/requests/options", () => ({
  handleOptions: vi.fn(async () => new Response()),
}));

vi.mock("~/src/requests/proxy", () => ({
  proxy: vi.fn(async () => new Response()),
}));

vi.mock("~/src/requests/chat_completions", () => ({
  chatCompletions: vi.fn(async () => new Response()),
}));

vi.mock("~/src/requests/models", () => ({
  models: vi.fn(async () => new Response()),
}));

vi.mock("~/src/requests/universal_endpoint", () => ({
  universalEndpoint: vi.fn(async () => new Response()),
}));

vi.mock("~/src/utils/authorization", () => ({
  authenticate: vi.fn(),
}));

vi.mock("~/src/utils/config", () => ({
  Config: {
    isDevelopment: vi.fn(),
    aiGateway: vi.fn(),
  },
}));

describe("fetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(authenticate).mockReturnValue(true);
    vi.mocked(Config.isDevelopment).mockReturnValue(false);
    vi.mocked(Config.aiGateway).mockReturnValue({
      accountId: "test-account-id",
      name: "test-gateway",
      token: "test-token",
    });
  });

  it("should handle OPTIONS request", async () => {
    const response = await SELF.fetch("https://example.com", {
      method: "OPTIONS",
    });

    expect(handleOptions).toHaveBeenCalledOnce();
    expect(authenticate).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it("should succeed with authentication", async () => {
    const response = await SELF.fetch("https://example.com/ping");

    expect(authenticate).toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it("should fail with invalid authentication", async () => {
    vi.mocked(authenticate).mockReturnValue(false);

    const response = await SELF.fetch("https://example.com/ping");

    expect(authenticate).toHaveBeenCalled();
    expect(response.status).toBe(401);
  });

  it("should skip authentication in development mode", async () => {
    vi.mocked(Config.isDevelopment).mockReturnValue(true);

    const response = await SELF.fetch("https://example.com/ping");

    expect(authenticate).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it("should handle requests starting with {PROVIDER_NAME}", async () => {
    await SELF.fetch("https://example.com/openai/notfound");

    expect(proxy).toHaveBeenCalledOnce();
  });

  it("should handle chat completions request", async () => {
    const request = new Request("https://example.com/chat/completions", {
      method: "POST",
    });

    await SELF.fetch(request);

    expect(chatCompletions).toHaveBeenCalledOnce();
  });

  it("should handle models request", async () => {
    const request = new Request("https://example.com/models", {
      method: "GET",
    });

    await SELF.fetch(request);

    expect(models).toHaveBeenCalledOnce();
  });

  it("should handle universal endpoint request", async () => {
    const request = new Request("https://example.com", {
      method: "POST",
    });

    await SELF.fetch(request);

    expect(universalEndpoint).toHaveBeenCalledOnce();
  });
});
