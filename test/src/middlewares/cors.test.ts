import { describe, it, expect, vi, beforeEach } from "vitest";
import { Context } from "~/src/middleware";
import { corsMiddleware } from "~/src/middlewares/cors";
import { handleOptions } from "~/src/requests/options";

vi.mock("~/src/requests/options", () => ({
  handleOptions: vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
}));

describe("corsMiddleware", () => {
  let context: Context;
  const next = vi.fn().mockResolvedValue(new Response("ok"));

  beforeEach(() => {
    vi.resetAllMocks();
    context = {
      request: new Request("http://localhost/"),
    } as Context;
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
});
