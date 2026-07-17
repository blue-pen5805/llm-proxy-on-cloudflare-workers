import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCompatibilityFallback } from "~/src/requests/compatibility_fallback";
import * as helpers from "~/src/utils/helpers";

vi.mock("~/src/utils/helpers");

describe("fetchCompatibilityFallback", () => {
  const requests: [RequestInfo, RequestInit][] = [
    ["https://gateway.example/compat/chat/completions", { method: "POST" }],
    ["https://gateway.example/compat/chat/completions", { method: "POST" }],
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the first successful response", async () => {
    const first = new Response("first");
    vi.mocked(helpers.fetch2).mockResolvedValue(first);

    await expect(fetchCompatibilityFallback(requests)).resolves.toBe(first);
    expect(helpers.fetch2).toHaveBeenCalledTimes(1);
  });

  it("tries the next request after an unsuccessful response", async () => {
    const first = new Response("unauthorized", { status: 401 });
    const cancel = vi.spyOn(first.body!, "cancel");
    const second = new Response("second");
    vi.mocked(helpers.fetch2)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    await expect(fetchCompatibilityFallback(requests)).resolves.toBe(second);
    expect(helpers.fetch2).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("tries the next request after a network error", async () => {
    const second = new Response("second");
    vi.mocked(helpers.fetch2)
      .mockRejectedValueOnce(new Error("network failure"))
      .mockResolvedValueOnce(second);

    await expect(fetchCompatibilityFallback(requests)).resolves.toBe(second);
  });

  it("returns the final HTTP error when every response is unsuccessful", async () => {
    const finalResponse = new Response("rate limited", { status: 429 });
    vi.mocked(helpers.fetch2)
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(finalResponse);

    await expect(fetchCompatibilityFallback(requests)).resolves.toBe(
      finalResponse,
    );
  });

  it("does not continue after cancellation", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));

    await expect(
      fetchCompatibilityFallback(requests, controller.signal),
    ).rejects.toThrow("cancelled");
    expect(helpers.fetch2).not.toHaveBeenCalled();
  });

  it("rejects an empty fallback sequence", async () => {
    await expect(fetchCompatibilityFallback([])).rejects.toThrow(
      "No AI Gateway compatibility requests were generated.",
    );
  });
});
