import { describe, expect, it, vi } from "vitest";
import {
  ChatResponseRouteMetadata,
  enrichChatResponseWithMetadata,
} from "~/src/requests/chat_response_metadata";

const directRoute: ChatResponseRouteMetadata = {
  provider: "openai",
  model: "gpt-4o-mini",
  credentialProfile: "default",
  credentialIndex: 1,
  viaAiGateway: false,
};

function metadataArguments(response: Response) {
  return {
    response,
    route: directRoute,
    requestedModel: "virtual/fast",
    requestId: "ray-test",
    startedAt: "2026-07-22T00:00:00.000Z",
    startedAtPerformance: performance.now(),
  };
}

describe("enrichChatResponseWithMetadata", () => {
  it("adds proxy metadata to a successful JSON object", async () => {
    const response = await enrichChatResponseWithMetadata(
      metadataArguments(
        new Response(
          JSON.stringify({
            id: "chatcmpl-test",
            object: "chat.completion",
            choices: [],
          }),
          {
            statusText: "Upstream OK",
            headers: {
              "Content-Type": "application/json",
              "Content-Length": "999",
              "Content-Encoding": "gzip",
              "Content-MD5": "stale",
              Digest: "stale",
              ETag: '"stale"',
              "X-Upstream": "kept",
            },
          },
        ),
      ),
    );

    expect(response.statusText).toBe("Upstream OK");
    expect(response.headers.get("X-Upstream")).toBe("kept");
    for (const header of [
      "Content-Length",
      "Content-Encoding",
      "Content-MD5",
      "Digest",
      "ETag",
    ]) {
      expect(response.headers.has(header)).toBe(false);
    }
    const body = (await response.json()) as Record<string, any>;
    expect(body.id).toBe("chatcmpl-test");
    expect(body.llm_proxy).toEqual({
      request_id: "ray-test",
      provider: "openai",
      model: "gpt-4o-mini",
      requested_model: "virtual/fast",
      credential_profile: "default",
      credential_index: 1,
      via_ai_gateway: false,
      started_at: "2026-07-22T00:00:00.000Z",
      headers_received_ms: expect.any(Number),
      completed_at: expect.any(String),
      duration_ms: expect.any(Number),
    });
  });

  it.each([
    ["a response without a content type", new Response(null)],
    ["a non-JSON upstream error", new Response("error", { status: 500 })],
    [
      "a non-JSON success",
      new Response("plain", { headers: { "Content-Type": "text/plain" } }),
    ],
    [
      "invalid JSON",
      new Response("not-json", {
        headers: { "Content-Type": "application/json" },
      }),
    ],
    [
      "a JSON array",
      new Response("[]", {
        headers: { "Content-Type": "application/json" },
      }),
    ],
  ])("preserves %s", async (_description, upstream) => {
    const response = await enrichChatResponseWithMetadata(
      metadataArguments(upstream),
    );

    expect(response).toBe(upstream);
  });

  it("adds route metadata to an object-valued upstream JSON error", async () => {
    const response = await enrichChatResponseWithMetadata(
      metadataArguments(
        Response.json({ error: { message: "rate limited" } }, { status: 429 }),
      ),
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      error: { message: "rate limited" },
      llm_proxy: { provider: "openai", model: "gpt-4o-mini" },
    });
  });

  it("continues when releasing the original JSON body fails", async () => {
    const cancel = vi.fn().mockRejectedValue(new Error("already closed"));
    const upstream = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "Content-Type": "application/json" }),
      body: { cancel },
      clone: () =>
        new Response('{"choices":[]}', {
          headers: { "Content-Type": "application/json" },
        }),
    } as unknown as Response;

    const response = await enrichChatResponseWithMetadata(
      metadataArguments(upstream),
    );

    expect(cancel).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({
      llm_proxy: { provider: "openai" },
    });
  });

  it("inserts a metadata chunk immediately before the SSE done marker", async () => {
    const encoder = new TextEncoder();
    const source = [
      'data: {"id":"one","choices":[{"delta":{"content":"こ"}}]}\n\n',
      "data: [DONE]\r\n\r\n",
    ].join("");
    const bytes = encoder.encode(source);
    const splitAt = source.indexOf("こ") + 1;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, splitAt));
        controller.enqueue(bytes.slice(splitAt));
        controller.close();
      },
    });
    const upstream = new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Content-Length": "999",
      },
    });

    const response = await enrichChatResponseWithMetadata({
      ...metadataArguments(upstream),
      route: {
        provider: "openai",
        model: "gpt-4o-mini",
        credentialProfile: "paid",
        viaAiGateway: true,
        gateway: "team-gateway",
      },
    });
    const text = await response.text();

    expect(response.headers.has("Content-Length")).toBe(false);
    expect(text).toContain('"content":"こ"');
    expect(text.indexOf('"id":"proxy-metadata"')).toBeLessThan(
      text.indexOf("data: [DONE]"),
    );
    const metadataLine = text
      .split(/\r?\n/)
      .find((line) => line.includes('"id":"proxy-metadata"'))!;
    const chunk = JSON.parse(metadataLine.slice("data: ".length));
    expect(chunk).toMatchObject({
      object: "chat.completion.chunk",
      model: "gpt-4o-mini",
      choices: [],
      llm_proxy: {
        provider: "openai",
        credential_profile: "paid",
        via_ai_gateway: true,
        gateway: "team-gateway",
      },
    });
    expect(chunk.llm_proxy).not.toHaveProperty("credential_index");
  });

  it("appends one metadata chunk when an SSE stream omits the done marker", async () => {
    const upstream = new Response('data: {"choices":[]}\n\ntrailing', {
      headers: { "Content-Type": "text/event-stream" },
    });

    const text = await (
      await enrichChatResponseWithMetadata({
        ...metadataArguments(upstream),
        requestId: undefined,
      })
    ).text();

    expect(text.match(/proxy-metadata/g)).toHaveLength(1);
    expect(text).not.toContain("request_id");
    expect(text.indexOf("trailing")).toBeLessThan(
      text.indexOf("proxy-metadata"),
    );
  });

  it("inserts metadata before a done marker that has no trailing newline", async () => {
    const upstream = new Response("data: [DONE]", {
      headers: { "Content-Type": "text/event-stream" },
    });

    const text = await (
      await enrichChatResponseWithMetadata(metadataArguments(upstream))
    ).text();

    expect(text.indexOf("proxy-metadata")).toBeLessThan(
      text.indexOf("data: [DONE]"),
    );
    expect(text.match(/proxy-metadata/g)).toHaveLength(1);
  });

  it("preserves an event-stream response without a body", async () => {
    const upstream = new Response(null, {
      headers: { "Content-Type": "text/event-stream" },
    });

    expect(
      await enrichChatResponseWithMetadata(metadataArguments(upstream)),
    ).toBe(upstream);
  });

  it("propagates downstream cancellation to the upstream SSE body", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      pull() {},
      cancel,
    });
    const upstream = new Response(stream, {
      headers: { "Content-Type": "text/event-stream" },
    });
    const response = await enrichChatResponseWithMetadata(
      metadataArguments(upstream),
    );

    await response.body!.cancel("client disconnected");

    expect(cancel).toHaveBeenCalledWith("client disconnected");
  });
});
