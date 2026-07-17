import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudflareAIGateway } from "~/src/ai_gateway";
import { handleCompatibilityRequest } from "~/src/requests/compat";
import { fetchWithLogging } from "~/src/utils/helpers";

vi.mock("~/src/utils/helpers", () => ({
  fetchWithLogging: vi.fn(),
}));

describe("compat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchWithLogging).mockResolvedValue(
      new Response(null, { status: 200 }),
    );
  });

  it("forwards chat completions requests without leaking proxy authorization", async () => {
    const body = JSON.stringify({ model: "gpt-4o", messages: [] });
    const request = new Request(
      "https://example.com/g/test-gateway/compat/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer proxy-api-key",
          "x-api-key": "proxy-api-key",
          "x-goog-api-key": "proxy-api-key",
          "x-client-header": "preserved",
        },
        body,
      },
    );

    const aiGateway = {
      buildCompatibilityEndpointRequest: vi.fn().mockReturnValue([
        "https://gateway.ai.cloudflare.com/v1/account/gateway/compat/chat/completions",
        {
          method: "POST",
          headers: { "cf-aig-authorization": "Bearer test" },
          body,
        },
      ]),
    } as unknown as CloudflareAIGateway;

    await handleCompatibilityRequest(request, aiGateway);

    const callArgs = vi.mocked(aiGateway.buildCompatibilityEndpointRequest).mock
      .calls[0][0];
    expect(callArgs.body).toBe(request.body);
    expect(callArgs.headers.authorization).toBeUndefined();
    expect(callArgs.headers["x-api-key"]).toBeUndefined();
    expect(callArgs.headers["x-goog-api-key"]).toBeUndefined();
    expect(callArgs.headers["x-client-header"]).toBe("preserved");
    expect(callArgs.signal).toBe(request.signal);

    expect(fetchWithLogging).toHaveBeenCalledWith(
      "https://gateway.ai.cloudflare.com/v1/account/gateway/compat/chat/completions",
      expect.objectContaining({
        method: "POST",
        body,
        headers: { "cf-aig-authorization": "Bearer test" },
      }),
    );
  });
});
