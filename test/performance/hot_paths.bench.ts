import { bench, describe } from "vitest";
import {
  BUILT_IN_PROVIDER_CONSTRUCTORS,
  createProviderRegistry,
} from "~/src/providers";
import { chatParameterFilter } from "~/src/providers/chat_parameters";
import { GoogleVertexAi } from "~/src/providers/google-vertex-ai";
import { OpenAI } from "~/src/providers/openai";
import { ProviderRegistry } from "~/src/providers/registry";
import { enrichChatResponseWithMetadata } from "~/src/requests/chat_response_metadata";
import { convertStreamingResponse as convertMessagesStream } from "~/src/requests/messages";
import { convertStreamingResponse as convertResponsesStream } from "~/src/requests/responses";
import {
  recordApiKeyOutcome,
  selectApiKeyIndex,
} from "~/src/utils/api_key_selection";
import { isRequestAuthorized } from "~/src/utils/authorization";
import { Environments } from "~/src/utils/environments";
import { getRequestPath, maskSensitiveUrl } from "~/src/utils/helpers";
import { Secrets } from "~/src/utils/secrets";

const chatBody = JSON.stringify({
  model: "openai/gpt-4o",
  messages: Array.from({ length: 100 }, (_, index) => ({
    role: "user",
    content: `${index}:${"x".repeat(512)}`,
  })),
  temperature: 0.2,
  unsupported: "discarded",
});

const filterChat = chatParameterFilter();
const openAiProvider = new OpenAI();
const parsedChatBody = JSON.parse(chatBody) as Record<string, unknown> & {
  model: string;
};
const registry = new ProviderRegistry(BUILT_IN_PROVIDER_CONSTRUCTORS, [
  { name: "internal.v2", baseUrl: "https://internal.example" },
]);
const loggedUrl =
  "https://api.example.com/v1/chat?api_key=sk-1234567890&model=gpt-4o&token=secret123456789";

describe("request hot paths", () => {
  bench("build a chat-completions request", async () => {
    await openAiProvider.endpoints.chat_completions!.buildRequest.call(
      openAiProvider,
      {
        data: parsedChatBody,
        headers: { Accept: "application/json" },
        target: "direct",
      },
    );
  });

  bench("filter supported chat parameters", () => {
    filterChat(parsedChatBody);
  });

  bench("match a provider route", () => {
    registry.match("/internal.v2/v1/chat/completions?stream=true");
  });

  bench("mask a logged subrequest URL", () => {
    maskSensitiveUrl(loggedUrl);
  });

  bench("extract a normalized request path", () => {
    getRequestPath(authorizedRequest);
  });
});

const requestEnv = {
  PROXY_API_KEY: JSON.stringify(
    Array.from(
      { length: 16 },
      (_, index) => `proxy-key-${index}-${"x".repeat(24)}`,
    ),
  ),
  OPENAI_API_KEY: JSON.stringify(
    Array.from({ length: 8 }, (_, index) => `sk-${index}-${"y".repeat(40)}`),
  ),
  CUSTOM_OPENAI_ENDPOINTS: JSON.stringify([
    { name: "internal.v2", baseUrl: "https://internal.example" },
  ]),
} as unknown as Env;

const authorizedRequest = new Request("https://proxy.example/v1/models", {
  headers: { Authorization: "Bearer proxy-key-15-" + "x".repeat(24) },
});

// Authentication compares every configured slot so the matching position is
// not observable, which makes its cost scale with the configured key count.
// This is the documented maximum.
const maximumProxyKeysEnv = {
  PROXY_API_KEY: JSON.stringify(
    Array.from(
      { length: 64 },
      (_, index) => `proxy-key-${index}-${"x".repeat(24)}`,
    ),
  ),
} as unknown as Env;
const lastSlotRequest = new Request("https://proxy.example/v1/models", {
  headers: { Authorization: "Bearer proxy-key-63-" + "x".repeat(24) },
});

describe("per-request setup paths", () => {
  bench("authenticate a proxied request", () => {
    Environments.run(requestEnv, () => isRequestAuthorized(authorizedRequest));
  });

  bench("authenticate against the maximum configured proxy keys", () => {
    Environments.run(maximumProxyKeysEnv, () =>
      isRequestAuthorized(lastSlotRequest),
    );
  });

  bench("resolve the provider registry", () => {
    Environments.run(requestEnv, () => createProviderRegistry(requestEnv));
  });

  bench("read a rotated provider secret list", () => {
    Environments.run(requestEnv, () => Secrets.getAll("OPENAI_API_KEY"));
  });

  bench("select a provider credential under cooldown", async () => {
    await Environments.run(requestEnv, async () => {
      // A cooled slot forces the eligibility scan and the forward search for
      // the next healthy slot, which the uncooled path skips entirely.
      recordApiKeyOutcome("openai", 3, 8, 429);
      await selectApiKeyIndex(openAiProvider, undefined, "rotate", "openai");
    });
  });
});

const vertexEnv = {
  GOOGLE_VERTEX_AI_SERVICE_ACCOUNT_JSON: JSON.stringify([
    {
      type: "service_account",
      project_id: "bench-project",
      private_key: `-----BEGIN PRIVATE KEY-----\n${"MIIEvQIBADANBg".repeat(120)}\n-----END PRIVATE KEY-----\n`,
      client_email: "bench@bench-project.iam.gserviceaccount.com",
      region: "us-central1",
    },
  ]),
} as unknown as Env;
const vertexProvider = new GoogleVertexAi();

describe("provider credential paths", () => {
  bench("read Vertex AI service-account credentials", () => {
    Environments.run(vertexEnv, () => vertexProvider.getApiKeys());
  });
});

const streamEncoder = new TextEncoder();
const syntheticSseChunks = Array.from({ length: 2_000 }, (_value, index) =>
  streamEncoder.encode(
    `data: ${JSON.stringify({
      id: "bench",
      choices: [
        {
          index: 0,
          delta: { content: `${index}:${"x".repeat(900)}` },
          finish_reason: null,
        },
      ],
    })}\n\n`,
  ),
);
const terminalSseChunk = streamEncoder.encode("data: [DONE]\n\n");

function syntheticSseResponse(): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of syntheticSseChunks) controller.enqueue(chunk);
        controller.enqueue(terminalSseChunk);
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

describe("SSE transformation hot paths", () => {
  bench("convert a Responses SSE stream", async () => {
    await convertResponsesStream(
      syntheticSseResponse(),
      { model: "openai/bench", input: "benchmark" },
      false,
    ).arrayBuffer();
  });

  bench("convert a Messages SSE stream", async () => {
    await convertMessagesStream(
      syntheticSseResponse(),
      {
        model: "openai/bench",
        max_tokens: 2_000,
        messages: [{ role: "user", content: "benchmark" }],
      },
      false,
    ).arrayBuffer();
  });

  bench("enrich a Chat Completions SSE stream", async () => {
    await (
      await enrichChatResponseWithMetadata({
        response: syntheticSseResponse(),
        route: {
          provider: "openai",
          model: "bench",
          credentialProfile: "default",
          credentialIndex: 0,
          viaAiGateway: true,
          gateway: "bench",
        },
        requestedModel: "openai/bench",
        requestId: "benchmark",
        startedAt: "2026-07-27T00:00:00.000Z",
        startedAtPerformance: performance.now(),
      })
    ).arrayBuffer();
  });
});
