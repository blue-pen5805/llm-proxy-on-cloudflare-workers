import { bench, describe } from "vitest";
import {
  BUILT_IN_PROVIDER_CONSTRUCTORS,
  createProviderRegistry,
} from "~/src/providers";
import { GoogleVertexAi } from "~/src/providers/google-vertex-ai";
import { ProviderBase } from "~/src/providers/provider";
import { ProviderRegistry } from "~/src/providers/registry";
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

const provider = new ProviderBase();
const parsedChatBody = JSON.parse(chatBody) as Record<string, unknown>;
const registry = new ProviderRegistry(BUILT_IN_PROVIDER_CONSTRUCTORS, [
  { name: "internal.v2", baseUrl: "https://internal.example" },
]);
const loggedUrl =
  "https://api.example.com/v1/chat?api_key=sk-1234567890&model=gpt-4o&token=secret123456789";

describe("request hot paths", () => {
  bench("build a chat-completions request", async () => {
    const preparedData = provider.filterSupportedChatParameters(parsedChatBody);
    await provider.buildChatCompletionsRequest({
      body: "",
      preparedData,
      headers: { Accept: "application/json" },
    });
  });

  bench("filter supported chat parameters", () => {
    provider.filterSupportedChatParameters(parsedChatBody);
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

describe("per-request setup paths", () => {
  bench("authenticate a proxied request", () => {
    Environments.run(requestEnv, () => isRequestAuthorized(authorizedRequest));
  });

  bench("resolve the provider registry", () => {
    Environments.run(requestEnv, () => createProviderRegistry(requestEnv));
  });

  bench("read a rotated provider secret list", () => {
    Environments.run(requestEnv, () => Secrets.getAll("OPENAI_API_KEY"));
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
