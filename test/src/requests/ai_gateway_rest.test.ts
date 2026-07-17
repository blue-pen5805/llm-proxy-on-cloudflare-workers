import { beforeEach, describe, expect, it, vi } from "vitest";
import { CloudflareAIGateway } from "~/src/ai_gateway";
import { aiGatewayRest } from "~/src/requests/ai_gateway_rest";
import { fetch2 } from "~/src/utils/helpers";

vi.mock("~/src/utils/helpers", () => ({
  fetch2: vi.fn(),
}));

describe("aiGatewayRest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetch2).mockResolvedValue(new Response(null, { status: 200 }));
  });

  it("streams a request without leaking proxy credentials", async () => {
    const body = JSON.stringify({ model: "openai/gpt-5.4", input: "Hello" });
    const request = new Request("https://example.com/ai/v1/responses", {
      method: "POST",
      headers: {
        Authorization: "Bearer proxy-api-key",
        "x-api-key": "proxy-api-key",
        "x-goog-api-key": "proxy-api-key",
        "cf-aig-metadata": '{"user":"123"}',
        "x-client-header": "preserved",
      },
      body,
    });
    const aiGateway = {
      buildRestApiRequest: vi
        .fn()
        .mockReturnValue([
          "https://api.cloudflare.com/client/v4/accounts/account/ai/v1/responses",
          { method: "POST", body },
        ]),
    } as unknown as CloudflareAIGateway;

    await aiGatewayRest(request, "/ai/v1/responses", aiGateway);

    const args = vi.mocked(aiGateway.buildRestApiRequest).mock.calls[0][0];
    const headers = new Headers(args.headers);
    expect(args.path).toBe("/ai/v1/responses");
    expect(args.body).toBe(request.body);
    expect(args.signal).toBe(request.signal);
    expect(headers.has("authorization")).toBe(false);
    expect(headers.has("x-api-key")).toBe(false);
    expect(headers.has("x-goog-api-key")).toBe(false);
    expect(headers.get("cf-aig-metadata")).toBe('{"user":"123"}');
    expect(headers.get("x-client-header")).toBe("preserved");
    expect(fetch2).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/accounts/account/ai/v1/responses",
      { method: "POST", body },
    );
  });

  it("rejects requests when the REST API token is missing", async () => {
    const request = new Request("https://example.com/ai/run", {
      method: "POST",
      body: "{}",
    });

    await expect(
      aiGatewayRest(
        request,
        "/ai/run",
        new CloudflareAIGateway("account", "default"),
      ),
    ).rejects.toThrow("AI Gateway REST API requires CLOUDFLARE_API_TOKEN.");
    expect(fetch2).not.toHaveBeenCalled();
  });
});
