import { headersForRewrittenBody } from "./response";
import { createSseRecordTransform, sseData } from "./sse";
import { StreamingResponseBudget } from "./stream_limits";

const MAX_CHAT_RESPONSE_BYTES = 5 * 1024 * 1024;

export interface ChatResponseRouteMetadata {
  provider: string;
  model: string;
  credentialProfile: string;
  credentialIndex?: number;
  viaAiGateway: boolean;
  gateway?: string;
}

interface ChatResponseMetadataArguments {
  response: Response;
  route: ChatResponseRouteMetadata;
  requestedModel: string;
  requestId?: string;
  startedAt: string;
  startedAtPerformance: number;
}

type ProxyResponseMetadata = {
  request_id?: string;
  provider: string;
  model: string;
  requested_model: string;
  credential_profile: string;
  credential_index?: number;
  via_ai_gateway: boolean;
  gateway?: string;
  started_at: string;
  headers_received_ms: number;
  completed_at: string;
  duration_ms: number;
};

function elapsedMilliseconds(startedAtPerformance: number): number {
  return Math.max(
    0,
    Math.round((performance.now() - startedAtPerformance) * 100) / 100,
  );
}

function createMetadata(
  args: Omit<ChatResponseMetadataArguments, "response">,
  headersReceivedMs: number,
): ProxyResponseMetadata {
  return {
    ...(args.requestId ? { request_id: args.requestId } : {}),
    provider: args.route.provider,
    model: args.route.model,
    requested_model: args.requestedModel,
    credential_profile: args.route.credentialProfile,
    ...(args.route.credentialIndex === undefined
      ? {}
      : { credential_index: args.route.credentialIndex }),
    via_ai_gateway: args.route.viaAiGateway,
    ...(args.route.gateway ? { gateway: args.route.gateway } : {}),
    started_at: args.startedAt,
    headers_received_ms: headersReceivedMs,
    completed_at: new Date().toISOString(),
    duration_ms: elapsedMilliseconds(args.startedAtPerformance),
  };
}

function metadataChunk(
  args: Omit<ChatResponseMetadataArguments, "response">,
  headersReceivedMs: number,
): string {
  return JSON.stringify({
    id: "proxy-metadata",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: args.route.model,
    choices: [],
    llm_proxy: createMetadata(args, headersReceivedMs),
  });
}

function enrichEventStream(
  response: Response,
  args: Omit<ChatResponseMetadataArguments, "response">,
  headersReceivedMs: number,
): Response {
  if (!response.body) return response;

  const encoder = new TextEncoder();
  const budget = new StreamingResponseBudget();
  let metadataWritten = false;
  const writeMetadata = (controller: TransformStreamDefaultController) => {
    if (metadataWritten) return;
    controller.enqueue(
      encoder.encode(`data: ${metadataChunk(args, headersReceivedMs)}\n\n`),
    );
    metadataWritten = true;
  };
  const fail = (
    controller: TransformStreamDefaultController<Uint8Array>,
    message: string,
  ) => {
    controller.enqueue(
      encoder.encode(
        `data: ${JSON.stringify({
          error: { type: "stream_error", message },
        })}\n\n`,
      ),
    );
    controller.terminate();
  };

  const body = response.body.pipeThrough(
    createSseRecordTransform({
      budget,
      onRecord(block, separator, controller) {
        if (sseData(block)?.trim() === "[DONE]") writeMetadata(controller);
        controller.enqueue(encoder.encode(block + separator));
      },
      onError(error, controller) {
        fail(controller, error.message);
      },
      onEnd(pending, controller) {
        if (sseData(pending)?.trim() === "[DONE]") writeMetadata(controller);
        if (pending) controller.enqueue(encoder.encode(pending));
        writeMetadata(controller);
      },
    }),
  );

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: headersForRewrittenBody(response.headers),
  });
}

/**
 * Read a JSON body once, without `clone()`.
 *
 * Teeing a response holds the whole body twice and leaves the unread branch
 * buffering when enrichment is abandoned. Instead the body is read directly:
 * if it outgrows the budget, the bytes already read are replayed ahead of the
 * untouched remainder so the caller can still forward the response unchanged.
 *
 * A body that decodes as strict UTF-8 is returned as text alone. The decoder
 * retains a byte order mark, so re-encoding that text reproduces the upstream
 * bytes exactly and the buffered chunks can be released before the far more
 * expensive parse and re-serialization run.
 */
async function readBoundedResponseBody(
  body: ReadableStream<Uint8Array>,
  maximumBytes: number,
): Promise<{ text: string } | { body: ReadableStream<Uint8Array> }> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    receivedBytes += value.byteLength;
    if (receivedBytes > maximumBytes) {
      return {
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk);
          },
          async pull(controller) {
            const next = await reader.read();
            if (next.done) {
              controller.close();
              return;
            }
            controller.enqueue(next.value);
          },
          cancel(reason) {
            return reader.cancel(reason);
          },
        }),
      };
    }
  }

  reader.releaseLock();
  const decoder = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true,
  });
  try {
    let text = "";
    for (const chunk of chunks) text += decoder.decode(chunk, { stream: true });
    return { text: text + decoder.decode() };
  } catch {
    // Metadata is optional. Preserve malformed UTF-8 byte-for-byte instead of
    // replacing invalid sequences while attempting to parse JSON.
    return {
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      }),
    };
  }
}

/** Add bounded JSON or streaming SSE metadata to a routed chat response. */
export async function enrichChatResponseWithMetadata(
  args: ChatResponseMetadataArguments,
): Promise<Response> {
  const { response, ...metadataArgs } = args;
  const headersReceivedMs = elapsedMilliseconds(args.startedAtPerformance);
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("text/event-stream")) {
    return enrichEventStream(response, metadataArgs, headersReceivedMs);
  }
  if (!contentType.includes("application/json") || !response.body) {
    return response;
  }

  const read = await readBoundedResponseBody(
    response.body,
    MAX_CHAT_RESPONSE_BYTES,
  );
  const forwardUnchanged = (body: BodyInit | null): Response =>
    new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: headersForRewrittenBody(response.headers),
    });
  if (!("text" in read)) {
    return forwardUnchanged(read.body);
  }

  // The decoder retains a byte order mark so the text stays byte-exact when it
  // is forwarded unchanged; JSON.parse must not see it.
  const { text } = read;
  const jsonText = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  let body: unknown;
  try {
    body = JSON.parse(jsonText) as unknown;
  } catch {
    return forwardUnchanged(text);
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return forwardUnchanged(text);
  }

  return forwardUnchanged(
    JSON.stringify({
      ...(body as Record<string, unknown>),
      llm_proxy: createMetadata(metadataArgs, headersReceivedMs),
    }),
  );
}
