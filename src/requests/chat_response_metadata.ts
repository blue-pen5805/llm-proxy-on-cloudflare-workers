import { readResponseJson } from "../utils/helpers";

const MAX_CHAT_RESPONSE_BYTES = 5 * 1024 * 1024;
const DONE_LINE_PATTERN = /^data:\s*\[DONE\]\s*\r?\n$/;

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

function responseHeaders(source: Headers): Headers {
  const headers = new Headers(source);
  for (const staleHeader of [
    "content-encoding",
    "content-length",
    "content-md5",
    "digest",
    "etag",
  ]) {
    headers.delete(staleHeader);
  }
  return headers;
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

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = "";
  let metadataWritten = false;
  const writeMetadata = (controller: TransformStreamDefaultController) => {
    if (metadataWritten) return;
    controller.enqueue(
      encoder.encode(`data: ${metadataChunk(args, headersReceivedMs)}\n\n`),
    );
    metadataWritten = true;
  };

  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        pending += decoder.decode(chunk, { stream: true });
        let newlineIndex: number;
        while ((newlineIndex = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, newlineIndex + 1);
          pending = pending.slice(newlineIndex + 1);
          if (DONE_LINE_PATTERN.test(line)) writeMetadata(controller);
          controller.enqueue(encoder.encode(line));
        }
      },
      flush(controller) {
        pending += decoder.decode();
        if (pending && DONE_LINE_PATTERN.test(`${pending}\n`)) {
          writeMetadata(controller);
        }
        if (pending) controller.enqueue(encoder.encode(pending));
        writeMetadata(controller);
      },
    }),
  );

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders(response.headers),
  });
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
  if (!contentType.includes("application/json")) return response;

  let body: unknown;
  try {
    body = await readResponseJson(response.clone(), MAX_CHAT_RESPONSE_BYTES);
  } catch {
    return response;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return response;
  }

  await response.body?.cancel().catch(() => undefined);
  return new Response(
    JSON.stringify({
      ...(body as Record<string, unknown>),
      llm_proxy: createMetadata(metadataArgs, headersReceivedMs),
    }),
    {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders(response.headers),
    },
  );
}
