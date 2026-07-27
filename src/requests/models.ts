import { CloudflareAIGateway } from "../ai_gateway";
import { gatewayProviderPath } from "../ai_gateway/custom_provider";
import { MiddlewareContext } from "../middleware";
import { getAllProviderInstances } from "../providers";
import { OpenAIModelsListResponseBody } from "../providers/openai/types";
import { parseProviderSelector } from "../providers/profile";
import { ProviderBase, ProviderNotSupportedError } from "../providers/provider";
import {
  determineApiKeySelectionPolicy,
  recordApiKeySelection,
  selectApiKeyIndex,
} from "../utils/api_key_selection";
import { stripProxyAuthorizationHeaders } from "../utils/authorization";
import { Config, VIRTUAL_MODEL_PROVIDER_NAME } from "../utils/config";
import { Environments } from "../utils/environments";
import {
  fetchWithLogging,
  readResponseJson,
  utf8ByteLength,
  withTimeout,
} from "../utils/helpers";
import { RequestLogger } from "../utils/logger";
import { openAIErrorResponse } from "./error_response";
import { resolveAiGatewayModelsProvider } from "./model_gateway";
import { PRIVATE_NO_STORE_HEADERS } from "./response";

// Timeout for individual provider model fetch operations (milliseconds)
const PROVIDER_FETCH_TIMEOUT_MS = 30_000;
const MAX_PROVIDER_MODELS_RESPONSE_BYTES = 1024 * 1024;
export const MAX_MODELS_PER_PROVIDER = 1000;
export const MAX_AGGREGATED_MODELS_BYTES = 4 * 1024 * 1024;

const MODELS_CACHE_NAME = "llm-proxy-models";

const EMPTY_MODELS: OpenAIModelsListResponseBody = {
  object: "list",
  data: [],
};

function reportModelsCacheUnavailable(
  operation: "open" | "match" | "put",
): void {
  RequestLogger.warn(
    "models.cache.unavailable",
    "Models cache operation was unavailable; continuing without it",
    { operation },
  );
}

async function putModelsCache(
  cache: Cache,
  key: Request,
  response: Response,
): Promise<void> {
  try {
    await cache.put(key, response);
  } catch {
    reportModelsCacheUnavailable("put");
  }
}

/**
 * Cache key for the aggregated models response. Built exclusively from
 * operator-validated values: account and gateway ids are charset-checked at
 * construction, and key selections are integers parsed by the `/key/...`
 * middleware. Clients cannot inject arbitrary partitions into the key.
 */
function buildModelsCacheKey(
  apiKeySelection: MiddlewareContext["apiKeyIndex"],
  aiGateway?: CloudflareAIGateway,
  providerFilter?: readonly string[],
): Request {
  const gatewayScope = aiGateway
    ? `${aiGateway.accountId}/${aiGateway.gatewayId}/${aiGateway.alwaysUse ? "always" : "auto"}`
    : "direct";
  const keyScope =
    apiKeySelection === undefined
      ? "default"
      : typeof apiKeySelection === "number"
        ? `index-${apiKeySelection}`
        : `range-${apiKeySelection.start ?? ""}-${apiKeySelection.end ?? ""}`;
  const providerScope =
    providerFilter === undefined
      ? "all"
      : `providers-${providerFilter.map(encodeURIComponent).join(",")}`;
  return new Request(
    `https://models-cache.llm-proxy.internal/${gatewayScope}/${keyScope}/${providerScope}`,
    { method: "GET" },
  );
}

function requestedProviders(
  request: Request | undefined,
  availableProviders: ReadonlySet<string>,
): string[] | Response | undefined {
  if (!request) return undefined;
  const values = new URL(request.url).searchParams.getAll("provider");
  if (values.length === 0) return undefined;
  if (values.length !== 1) {
    return openAIErrorResponse("provider must be specified once.", 400, {
      param: "provider",
    });
  }
  const providers = [
    ...new Set(values[0].split(",").map((value) => value.trim())),
  ];
  if (
    providers.length === 0 ||
    providers.length > 32 ||
    providers.some(
      (provider) =>
        provider === "" ||
        (provider !== VIRTUAL_MODEL_PROVIDER_NAME &&
          !availableProviders.has(provider)),
    )
  ) {
    return openAIErrorResponse("Invalid provider filter.", 400, {
      param: "provider",
    });
  }
  return providers.sort();
}

async function fetchProviderModels(
  providerSelector: string,
  provider: ProviderBase,
  selection: MiddlewareContext["apiKeyIndex"],
  aiGateway?: CloudflareAIGateway,
  clientGatewayHeaders?: HeadersInit,
): Promise<OpenAIModelsListResponseBody> {
  const parsedSelector = parseProviderSelector(providerSelector);
  /* istanbul ignore next -- registry entries always use valid selectors */
  if (!parsedSelector) return EMPTY_MODELS;
  const { providerName, profile } = parsedSelector;
  const aiGatewayProvider = resolveAiGatewayModelsProvider(
    providerName,
    provider,
    aiGateway,
  );
  if (
    !provider.available() &&
    (!aiGatewayProvider || provider.requiresProviderCredentialsForModels)
  ) {
    return EMPTY_MODELS;
  }

  const getStaticModels = provider.getStaticModels();
  if (getStaticModels) {
    return getStaticModels;
  }

  const apiKeyIndex = await selectApiKeyIndex(provider, selection, "first");
  const keyLogFields = recordApiKeySelection({
    provider: providerName,
    credentialProfile: profile,
    operation: "models",
    keyIndex: apiKeyIndex,
    keyCount: provider.getApiKeys().length,
    selectionPolicy: determineApiKeySelectionPolicy(selection, "first"),
    viaAiGateway: aiGatewayProvider !== undefined,
  });
  const [path, init] = await provider.buildModelsRequest(apiKeyIndex);
  const abortController = new AbortController();

  let responsePromise: Promise<Response>;
  if (aiGateway && aiGatewayProvider) {
    const gatewayHeaders = new Headers(clientGatewayHeaders);
    const providerHeaders = new Headers(await provider.headers(apiKeyIndex));
    providerHeaders.forEach((value, key) => gatewayHeaders.set(key, value));
    const [gatewayUrl, gatewayInit] = aiGateway.buildProviderEndpointRequest({
      provider: aiGatewayProvider,
      method: init.method,
      path: gatewayProviderPath(
        providerName,
        provider,
        path,
        aiGatewayProvider,
      ),
      headers: gatewayHeaders,
    });
    responsePromise = RequestLogger.withFields(keyLogFields, () =>
      fetchWithLogging(gatewayUrl, {
        ...gatewayInit,
        signal: abortController.signal,
      }),
    );
  } else {
    responsePromise = RequestLogger.withFields(keyLogFields, () =>
      provider.fetch(
        path,
        { ...init, signal: abortController.signal },
        apiKeyIndex,
      ),
    );
  }

  const modelsPromise = responsePromise.then(async (upstreamResponse) => {
    if (!upstreamResponse.ok) {
      if (upstreamResponse.body) {
        try {
          await upstreamResponse.body.cancel();
        } catch {
          // The status is still authoritative if the body is already locked.
        }
      }
      throw new Error(
        `Provider models request failed with HTTP ${upstreamResponse.status}.`,
      );
    }
    return provider.convertModelsToOpenAIFormat(
      await readResponseJson(
        upstreamResponse,
        MAX_PROVIDER_MODELS_RESPONSE_BYTES,
      ),
    );
  });
  return withTimeout(
    modelsPromise,
    abortController,
    PROVIDER_FETCH_TIMEOUT_MS,
    providerName,
  );
}

/**
 * A served aggregate plus, on the uncached path, the per-model JSON fragments
 * it was assembled from and their ids in the same order.
 * `/v1/models/<model>` reuses those fragments so it never re-parses the
 * aggregate it just serialized.
 */
interface AggregatedModels {
  response: Response;
  models?: { ids: string[]; serialized: string[] };
}

export async function handleModelsRequest(
  context: MiddlewareContext,
  aiGateway: CloudflareAIGateway | undefined = undefined,
): Promise<Response> {
  return (await aggregateModels(context, aiGateway)).response;
}

async function aggregateModels(
  context: MiddlewareContext,
  aiGateway: CloudflareAIGateway | undefined,
): Promise<AggregatedModels> {
  const allProviderEntries = Object.entries(
    context.providers?.all() ?? getAllProviderInstances(Environments.all()),
  );
  const providerFilter = requestedProviders(
    context.request,
    new Set(allProviderEntries.map(([providerName]) => providerName)),
  );
  if (providerFilter instanceof Response) return { response: providerFilter };
  const providerFilterSet =
    providerFilter === undefined ? undefined : new Set(providerFilter);
  const sanitizedGatewayHeaders =
    aiGateway && context.request
      ? stripProxyAuthorizationHeaders(context.request.headers, {
          preserveAiGatewayHeaders: true,
        })
      : undefined;
  const clientGatewayHeaders: Record<string, string> = {};
  let hasClientGatewayTuning = false;
  sanitizedGatewayHeaders?.forEach((value, key) => {
    if (key.startsWith("cf-aig-")) {
      clientGatewayHeaders[key] = value;
      hasClientGatewayTuning = true;
    }
  });
  // The provider fan-out is expensive (one upstream request per provider), so
  // successful aggregates are cached briefly. Requests carrying per-request
  // Gateway tuning (`cf-aig-*`) or `Cache-Control: no-store` bypass the cache
  // entirely; `Cache-Control: no-cache` skips the read but refreshes the entry.
  const cacheTtlSeconds = Config.modelsCacheTtlSeconds();
  const requestCacheControl =
    context.request?.headers.get("Cache-Control")?.toLowerCase() ?? "";
  const cacheEnabled =
    cacheTtlSeconds > 0 &&
    !hasClientGatewayTuning &&
    !requestCacheControl.includes("no-store");
  let modelsCache: { cache: Cache; key: Request } | undefined;
  if (cacheEnabled) {
    try {
      const cache = await caches.open(MODELS_CACHE_NAME);
      const candidate = {
        cache,
        key: buildModelsCacheKey(
          context.apiKeyIndex,
          aiGateway,
          providerFilter,
        ),
      };
      let cacheUsable = true;
      if (!requestCacheControl.includes("no-cache")) {
        try {
          const cachedResponse = await cache.match(candidate.key);
          if (cachedResponse) {
            const cachedHeaders = new Headers(cachedResponse.headers);
            // The stored Cache-Control only encodes the internal TTL; it must
            // not let a response served under Authorization enter shared HTTP
            // caches.
            cachedHeaders.set(
              "Cache-Control",
              PRIVATE_NO_STORE_HEADERS["Cache-Control"],
            );
            cachedHeaders.set("X-Proxy-Models-Cache", "HIT");
            return {
              response: new Response(cachedResponse.body, {
                headers: cachedHeaders,
              }),
            };
          }
        } catch {
          reportModelsCacheUnavailable("match");
          // A failed cache read is treated as an unavailable Cache API for the
          // whole request. Provider discovery remains authoritative.
          cacheUsable = false;
        }
      }
      if (cacheUsable) modelsCache = candidate;
    } catch {
      reportModelsCacheUnavailable("open");
    }
  }

  const providerEntries = allProviderEntries.filter(
    ([providerName]) =>
      providerFilterSet === undefined || providerFilterSet.has(providerName),
  );
  // Models are kept as their serialized JSON so the byte budget and the final
  // response body reuse one JSON.stringify pass per model. Their ids are kept
  // alongside, in the same order, so a single-model retrieval can locate one
  // fragment without parsing the aggregate.
  const serializedModels: string[] = [];
  const modelIds: string[] = [];
  let aggregatedBytes = 0;
  let truncated = false;
  let providerFailed = false;

  // Operator-defined virtual models are advertised at the front of the list so
  // clients discover them ahead of provider models. They are bounded (at most
  // MAX_VIRTUAL_MODELS) and cheap, so they are always included; only their bytes
  // are counted against the aggregate budget. A malformed VIRTUAL_MODELS value
  // fails closed here exactly as it does on a chat request.
  const virtualModels = Config.virtualModels();
  if (
    virtualModels &&
    (providerFilterSet === undefined ||
      providerFilterSet.has(VIRTUAL_MODEL_PROVIDER_NAME))
  ) {
    for (const virtualModelId of Object.keys(virtualModels)) {
      const serializedModel = JSON.stringify({
        id: virtualModelId,
        object: "model",
        created: 0,
        owned_by: VIRTUAL_MODEL_PROVIDER_NAME,
      });
      serializedModels.push(serializedModel);
      modelIds.push(virtualModelId);
      aggregatedBytes += utf8ByteLength(serializedModel);
    }
  }

  const settledModelRequests = await Promise.allSettled(
    providerEntries.map(([providerName, provider]) =>
      fetchProviderModels(
        providerName,
        provider,
        context.apiKeyIndex,
        aiGateway,
        hasClientGatewayTuning ? clientGatewayHeaders : undefined,
      ),
    ),
  );

  for (const [index, settledRequest] of settledModelRequests.entries()) {
    const providerName = providerEntries[index][0];
    if (settledRequest.status === "rejected") {
      if (!(settledRequest.reason instanceof ProviderNotSupportedError)) {
        providerFailed = true;
        RequestLogger.error(
          "provider.models.failed",
          "Provider model discovery failed",
          settledRequest.reason,
          {
            provider: providerName,
          },
        );
      }
      continue;
    }
    if (!Array.isArray(settledRequest.value?.data)) {
      providerFailed = true;
      RequestLogger.warn(
        "provider.models.invalid_response",
        "Provider model discovery returned an invalid response",
        {
          provider: providerName,
        },
      );
      continue;
    }

    for (const { id, ...model } of settledRequest.value.data.slice(
      0,
      MAX_MODELS_PER_PROVIDER,
    )) {
      const qualifiedModelId = `${providerName}/${id}`;
      const serializedModel = JSON.stringify({
        id: qualifiedModelId,
        ...model,
      });
      const modelBytes = utf8ByteLength(serializedModel);
      if (aggregatedBytes + modelBytes > MAX_AGGREGATED_MODELS_BYTES) {
        truncated = true;
        break;
      }
      serializedModels.push(serializedModel);
      modelIds.push(qualifiedModelId);
      aggregatedBytes += modelBytes;
    }
    if (truncated) break;
  }

  if (truncated) {
    RequestLogger.warn(
      "provider.models.aggregate_truncated",
      "Aggregated model list was truncated",
      {
        maximum_bytes: MAX_AGGREGATED_MODELS_BYTES,
      },
    );
  }

  const responseBody = `{"data":[${serializedModels.join(",")}],"object":"list"}`;
  const responseHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...PRIVATE_NO_STORE_HEADERS,
    ...(truncated ? { "X-Proxy-Models-Truncated": "true" } : {}),
  };

  if (modelsCache === undefined) {
    return {
      response: new Response(responseBody, { headers: responseHeaders }),
      models: { ids: modelIds, serialized: serializedModels },
    };
  }

  // Degraded aggregates (a failed provider or a truncated list) are served but
  // never cached, so a transient upstream outage cannot pin an incomplete
  // model list for the full TTL.
  if (!providerFailed && !truncated) {
    const cachePutPromise = putModelsCache(
      modelsCache.cache,
      modelsCache.key,
      new Response(responseBody, {
        headers: {
          ...responseHeaders,
          "Cache-Control": `public, max-age=${cacheTtlSeconds}`,
        },
      }),
    );
    if (context.ctx !== undefined) {
      context.ctx.waitUntil(cachePutPromise);
    } else {
      await cachePutPromise;
    }
  }

  return {
    response: new Response(responseBody, {
      headers: { ...responseHeaders, "X-Proxy-Models-Cache": "MISS" },
    }),
    models: { ids: modelIds, serialized: serializedModels },
  };
}

export async function handleModelRetrieveRequest(
  context: MiddlewareContext,
  modelId: string,
  aiGateway: CloudflareAIGateway | undefined = undefined,
): Promise<Response> {
  const { response: modelsResponse, models } = await aggregateModels(
    context,
    aiGateway,
  );
  if (!modelsResponse.ok) return modelsResponse;

  const headers = new Headers(modelsResponse.headers);
  headers.delete("X-Proxy-Models-Truncated");

  // The aggregate was just assembled from these fragments, so the matching one
  // is returned directly instead of parsing back the list that was serialized a
  // moment earlier. A cache hit carries no fragments and reads the stored body.
  if (models) {
    const modelIndex = models.ids.indexOf(modelId);
    if (modelIndex === -1) return modelNotFound(modelId);
    headers.set("Content-Type", "application/json");
    return new Response(models.serialized[modelIndex], { headers });
  }

  const cachedModels =
    (await modelsResponse.json()) as OpenAIModelsListResponseBody;
  const model = cachedModels.data.find((candidate) => candidate.id === modelId);
  if (!model) return modelNotFound(modelId);
  return Response.json(model, { headers });
}

function modelNotFound(modelId: string): Response {
  return openAIErrorResponse(`Model '${modelId}' not found.`, 404, {
    code: "model_not_found",
    param: "model",
  });
}
