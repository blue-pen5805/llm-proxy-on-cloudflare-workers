import { describe, it, expect, vi, beforeEach } from "vitest";
import { MiddlewareContext } from "~/src/middleware";
import { corsMiddleware } from "~/src/middlewares/cors";
import { handleOptions } from "~/src/requests/options";

vi.mock("~/src/requests/options", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/src/requests/options")>()),
  handleOptions: vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
}));

describe("corsMiddleware", () => {
  let context: MiddlewareContext;
  const next = vi.fn().mockResolvedValue(new Response("ok"));

  beforeEach(() => {
    vi.resetAllMocks();
    next.mockResolvedValue(new Response("ok"));
    context = {
      request: new Request("http://localhost/"),
    } as MiddlewareContext;
  });

  it("should call handleOptions for OPTIONS requests", async () => {
    context.request = new Request("http://localhost/", { method: "OPTIONS" });
    const optionsResponse = new Response(null, { status: 204 });
    vi.mocked(handleOptions).mockResolvedValue(optionsResponse);

    const response = await corsMiddleware(context, next);

    expect(handleOptions).toHaveBeenCalledWith(context.request);
    expect(response.status).toBe(204);
    expect(next).not.toHaveBeenCalled();
  });

  it("should call next for non-OPTIONS requests", async () => {
    context.request = new Request("http://localhost/", { method: "POST" });
    const nextResponse = new Response("ok");
    next.mockResolvedValue(nextResponse);

    const response = await corsMiddleware(context, next);

    expect(next).toHaveBeenCalled();
    expect(await response.text()).toBe("ok");
    expect(handleOptions).not.toHaveBeenCalled();
  });

  it("adds CORS headers to actual cross-origin responses", async () => {
    context.request = new Request("http://localhost/", {
      headers: { Origin: "https://client.example" },
    });
    next.mockResolvedValue(
      new Response("created", {
        status: 201,
        headers: { "X-Upstream": "preserved" },
      }),
    );

    const response = await corsMiddleware(context, next);

    expect(response.status).toBe(201);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("X-Upstream")).toBe("preserved");
    expect(await response.text()).toBe("created");
  });

  it("does not add CORS headers without an Origin", async () => {
    const response = await corsMiddleware(context, next);

    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
