import { createExecutionContext } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";
import app from "~/src/index";

afterEach(() => vi.restoreAllMocks());

const providers = [
  { provider: "replicate", path: "/predictions", binding: "REPLICATE_API_KEY" },
  {
    provider: "huggingface",
    path: "/owner/model",
    binding: "HUGGINGFACE_API_KEY",
  },
];

it.each(providers)(
  "authenticates $provider pass-through with the selected profile and slot",
  async ({ provider, path, binding }) => {
    for (const gateway of [false, true]) {
      const fetcher = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response("fixture"));
      const response = await app.request(
        `/key/1/${provider}:paid${path}`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer example-proxy",
            "content-type": "application/json",
            "x-api-key": "example-proxy",
            cookie: "example=private",
          },
          body: "{}",
        },
        {
          PROXY_API_KEY: "example-proxy",
          [binding]: JSON.stringify({
            default: "example-default",
            paid: ["example-paid-0", "example-paid-1"],
          }),
          ...(gateway
            ? {
                CLOUDFLARE_ACCOUNT_ID: "example-account",
                AI_GATEWAY_NAME: "example-gateway",
              }
            : {}),
        } as Env,
        createExecutionContext(),
      );
      expect(response.status).toBe(200);
      expect(fetcher).toHaveBeenCalledOnce();
      const [url, init] = fetcher.mock.calls[0];
      expect(String(url).includes("gateway.ai.cloudflare.com")).toBe(gateway);
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer example-paid-1");
      expect(headers.get("content-type")).toBe("application/json");
      expect(headers.has("x-api-key")).toBe(false);
      expect(headers.has("cookie")).toBe(false);
      fetcher.mockRestore();
    }
  },
);

it.each(providers)(
  "leaves $provider authentication absent when no local key is configured",
  async ({ provider, path }) => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("fixture"));
    const response = await app.request(
      `/${provider}${path}`,
      { headers: { authorization: "Bearer example-proxy" } },
      {
        PROXY_API_KEY: "example-proxy",
        CLOUDFLARE_ACCOUNT_ID: "example-account",
        AI_GATEWAY_NAME: "example-gateway",
      } as Env,
      createExecutionContext(),
    );
    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(
      new Headers(fetcher.mock.calls[0][1]?.headers).has("authorization"),
    ).toBe(false);
  },
);
