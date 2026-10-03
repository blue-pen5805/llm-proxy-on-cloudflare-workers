import { isJsonObject } from "../../requests/sse";
import { AppError, BadRequestError } from "../../utils/error";
import {
  fetchWithLogging,
  readResponseJson,
  withTimeout,
} from "../../utils/helpers";
import { RequestLogger } from "../../utils/logger";
import {
  chatCompletionsEndpoint,
  convertedChatEndpoint,
  jsonEndpoint,
  type InferenceEndpoint,
  type PublicInferenceProtocol,
} from "../inference";
import { generateContentEndpoint, messagesEndpoint } from "../native";
import { defineProvider, type ProviderDefinition } from "../provider";
import { responsesEndpoint } from "../responses";

const CATALOG_URL = "https://models.opencode.ai/api.json";
const MAX_CATALOG_BYTES = 8 * 1024 * 1024;
const CATALOG_TIMEOUT_MS = 5_000;
const CATALOG_CACHE_NAME = "llm-proxy-opencode-protocol-v1";
const CATALOG_CACHE_TTL_SECONDS = 300;

function cacheUnavailable(operation: "read" | "write"): void {
  RequestLogger.warn(
    "opencode.catalog.cache.unavailable",
    "OpenCode catalog cache unavailable; continuing without it",
    { operation },
  );
}

const chat = chatCompletionsEndpoint();
const responses = jsonEndpoint("/responses");
const messages = jsonEndpoint("/messages");
const responsesFallback = convertedChatEndpoint(responsesEndpoint);
const messagesFallback = convertedChatEndpoint({
  ...messagesEndpoint,
  prepare(data) {
    return { ...messagesEndpoint.prepare(data), path: "/messages" };
  },
});
const googleFallback = convertedChatEndpoint({
  ...generateContentEndpoint,
  prepare(data) {
    const prepared = generateContentEndpoint.prepare(data);
    return { ...prepared, path: prepared.path.slice("/v1beta".length) };
  },
});

const SDK_OPERATIONS: Readonly<
  Record<
    string,
    {
      protocol?: PublicInferenceProtocol;
      endpoint: InferenceEndpoint;
      fallback: InferenceEndpoint;
    }
  >
> = {
  "@ai-sdk/openai-compatible": {
    protocol: "chat_completions",
    endpoint: chat,
    fallback: chat,
  },
  "@ai-sdk/openai": {
    protocol: "responses",
    endpoint: responses,
    fallback: responsesFallback,
  },
  "@ai-sdk/anthropic": {
    protocol: "messages",
    endpoint: messages,
    fallback: messagesFallback,
  },
  "@ai-sdk/google": { endpoint: googleFallback, fallback: googleFallback },
};

function invalidCatalog(): AppError {
  return new AppError(
    "OpenCode protocol catalog is unavailable or invalid.",
    502,
  );
}

async function modelSdk(
  catalogProvider: string,
  model: string,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const catalogSignal = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;
  try {
    return await withTimeout(
      (async () => {
        let cache: Cache | undefined;
        try {
          cache = await caches.open(CATALOG_CACHE_NAME);
          const cached = await cache.match(CATALOG_URL);
          if (cached) {
            const catalog = await readResponseJson(cached, MAX_CATALOG_BYTES);
            catalogSignal.throwIfAborted();
            return selectModelSdk(catalog, catalogProvider, model);
          }
        } catch {
          catalogSignal.throwIfAborted();
          cacheUnavailable("read");
        }
        catalogSignal.throwIfAborted();
        const response = await fetchWithLogging(CATALOG_URL, {
          headers: { accept: "application/json" },
          redirect: "manual",
          cache: "no-store",
          signal: catalogSignal,
        });
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          throw invalidCatalog();
        }
        const catalog = await readResponseJson(response, MAX_CATALOG_BYTES);
        if (!isJsonObject(catalog)) throw invalidCatalog();
        const sdk = selectModelSdk(catalog, catalogProvider, model);
        catalogSignal.throwIfAborted();
        if (cache) {
          try {
            // Retain only OpenCode entries, avoiding unrelated provider metadata
            // on subsequent reads. No request data or credentials enter the cache.
            await cache.put(
              CATALOG_URL,
              Response.json(
                {
                  opencode: catalog.opencode,
                  "opencode-go": catalog["opencode-go"],
                },
                {
                  headers: {
                    "cache-control": `public, max-age=${CATALOG_CACHE_TTL_SECONDS}`,
                  },
                },
              ),
            );
          } catch {
            cacheUnavailable("write");
          }
        }
        catalogSignal.throwIfAborted();
        return sdk;
      })(),
      controller,
      CATALOG_TIMEOUT_MS,
      catalogProvider,
    );
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof BadRequestError) throw error;
    throw invalidCatalog();
  }
}

function selectModelSdk(
  catalog: unknown,
  catalogProvider: string,
  model: string,
): string {
  if (!isJsonObject(catalog)) throw invalidCatalog();
  const provider = catalog[catalogProvider];
  if (!isJsonObject(provider) || !isJsonObject(provider.models))
    throw invalidCatalog();
  if (!Object.hasOwn(provider.models, model)) {
    throw new BadRequestError(
      "Unknown OpenCode model in the protocol catalog.",
    );
  }
  const entry = provider.models[model];
  if (!isJsonObject(entry)) throw invalidCatalog();
  if (entry.provider !== undefined && !isJsonObject(entry.provider))
    throw invalidCatalog();
  const npm = entry.provider?.npm ?? provider.npm;
  if (typeof npm !== "string" || !Object.hasOwn(SDK_OPERATIONS, npm))
    throw invalidCatalog();
  return npm;
}

function openCodeDefinition(
  catalogProvider: string,
  baseUrl: string,
): ProviderDefinition {
  return {
    endpoints: { models: { path: "/models" } },
    openAICompatible: true,
    apiKeyName: "OPENCODE_API_KEY",
    baseUrl,
    async resolveInference(model, protocol, signal) {
      const operation =
        SDK_OPERATIONS[await modelSdk(catalogProvider, model, signal)];
      const native = operation.protocol === protocol;
      return {
        endpoint: native ? operation.endpoint : operation.fallback,
        native,
      };
    },
    async buildHeadersForPath(pathname, headers, apiKeyIndex) {
      const merged = new Headers(headers);
      new Headers(await this.headers(apiKeyIndex)).forEach((value, key) =>
        merged.set(key, value),
      );
      const messagesPath = pathname.split("?")[0] === "/messages";
      const googlePath =
        /^\/models\/[^/]+:(?:streamGenerateContent|generateContent)(?:\?|$)/.test(
          pathname,
        );
      if (messagesPath || googlePath) {
        const authorization = merged.get("authorization");
        merged.delete("authorization");
        if (authorization)
          merged.set(
            messagesPath ? "x-api-key" : "x-goog-api-key",
            authorization.slice("Bearer ".length),
          );
      }
      if (messagesPath && !merged.has("anthropic-version"))
        merged.set("anthropic-version", "2023-06-01");
      return merged;
    },
  };
}

export const OpenCodeZen = defineProvider(
  openCodeDefinition("opencode", "https://opencode.ai/zen/v1"),
);
export const OpenCodeGo = defineProvider(
  openCodeDefinition("opencode-go", "https://opencode.ai/zen/go/v1"),
);
