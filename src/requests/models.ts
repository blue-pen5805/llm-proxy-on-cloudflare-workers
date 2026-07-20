import { CloudflareAIGateway } from "../ai_gateway";
import { gatewayProviderPath } from "../ai_gateway/custom_provider";
import { MiddlewareContext } from "../middleware";
import { getAllProviderInstances } from "../providers";
import { OpenAIModelsListResponseBody } from "../providers/openai/types";
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
import { resolveAiGatewayModelsProvider } from "./model_gateway";

// Timeout for individual provider model fetch operations (milliseconds)
const PROVIDER_FETCH_TIMEOUT_MS = 5000;
export const MODEL_PROVIDER_CONCURRENCY = 5;
export const MAX_PROVIDER_MODELS_RESPONSE_BYTES = 1024 * 1024;
export const MAX_MODELS_PER_PROVIDER = 1000;
export const MAX_AGGREGATED_MODELS_BYTES = 4 * 1024 * 1024;

export const MODELS_CACHE_NAME = "llm-proxy-models";

const EMPTY_MODELS: OpenAIModelsListResponseBody = {
  object: "list",
  data: [],
};

/**
 * Cache key for the aggregated models response. Built exclusively from
 * operator-validated values: account and gateway ids are charset-checked at
 * construction, and key selections are integers parsed by the `/key/...`
 * middleware. Clients cannot inject arbitrary partitions into the key.
 */
function buildModelsCacheKey(
  apiKeySelection: MiddlewareContext["apiKeyIndex"],
  aiGateway?: CloudflareAIGateway,
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
  return new Request(
    `https://models-cache.llm-proxy.internal/${gatewayScope}/${keyScope}`,
    { method: "GET" },
  );
}

async function fetchProviderModels(
  providerName: string,
  provider: ProviderBase,
  selection: MiddlewareContext["apiKeyIndex"],
  aiGateway?: CloudflareAIGateway,
  clientGatewayHeaders?: HeadersInit,
): Promise<OpenAIModelsListResponseBody> {
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

export async function handleModelsRequest(
  context: MiddlewareContext,
  aiGateway: CloudflareAIGateway | undefined = undefined,
) {
  const sanitizedGatewayHeaders =
    aiGateway && context.request
      ? stripProxyAuthorizationHeaders(context.request.headers, {
          preserveAiGatewayHeaders: true,
        })
      : undefined;
  const clientGatewayHeaders = sanitizedGatewayHeaders
    ? Object.fromEntries(
        [...sanitizedGatewayHeaders.entries()].filter(([key]) =>
          key.startsWith("cf-aig-"),
        ),
      )
    : undefined;
  // The provider fan-out is expensive (one upstream request per provider), so
  // successful aggregates are cached briefly. Requests carrying per-request
  // Gateway tuning (`cf-aig-*`) or `Cache-Control: no-store` bypass the cache
  // entirely; `Cache-Control: no-cache` skips the read but refreshes the entry.
  const cacheTtlSeconds = Config.modelsCacheTtlSeconds();
  const requestCacheControl =
    context.request?.headers.get("Cache-Control")?.toLowerCase() ?? "";
  const hasClientGatewayTuning =
    clientGatewayHeaders !== undefined &&
    Object.keys(clientGatewayHeaders).length > 0;
  const cacheEnabled =
    cacheTtlSeconds > 0 &&
    !hasClientGatewayTuning &&
    !requestCacheControl.includes("no-store");
  let modelsCache: { cache: Cache; key: Request } | undefined;
  if (cacheEnabled) {
    modelsCache = {
      cache: await caches.open(MODELS_CACHE_NAME),
      key: buildModelsCacheKey(context.apiKeyIndex, aiGateway),
    };
    if (!requestCacheControl.includes("no-cache")) {
      const cachedResponse = await modelsCache.cache.match(modelsCache.key);
      if (cachedResponse) {
        const cachedHeaders = new Headers(cachedResponse.headers);
        // The stored Cache-Control only encodes the internal TTL; it must not
        // let a response served under Authorization enter shared HTTP caches.
        cachedHeaders.delete("Cache-Control");
        cachedHeaders.set("X-Proxy-Models-Cache", "HIT");
        return new Response(cachedResponse.body, { headers: cachedHeaders });
      }
    }
  }

  const providerEntries = Object.entries(
    context.providers?.all() ?? getAllProviderInstances(Environments.all()),
  );
  // Models are kept as their serialized JSON so the byte budget and the final
  // response body reuse one JSON.stringify pass per model.
  const serializedModels: string[] = [];
  let aggregatedBytes = 0;
  let truncated = false;
  let providerFailed = false;

  // Operator-defined virtual models are advertised at the front of the list so
  // clients discover them ahead of provider models. They are bounded (at most
  // MAX_VIRTUAL_MODELS) and cheap, so they are always included; only their bytes
  // are counted against the aggregate budget. A malformed VIRTUAL_MODELS value
  // fails closed here exactly as it does on a chat request.
  const virtualModels = Config.virtualModels();
  if (virtualModels) {
    for (const virtualModelId of Object.keys(virtualModels)) {
      const serializedModel = JSON.stringify({
        id: virtualModelId,
        object: "model",
        created: 0,
        owned_by: VIRTUAL_MODEL_PROVIDER_NAME,
      });
      serializedModels.push(serializedModel);
      aggregatedBytes += utf8ByteLength(serializedModel);
    }
  }

  for (
    let batchStart = 0;
    batchStart < providerEntries.length && !truncated;
    batchStart += MODEL_PROVIDER_CONCURRENCY
  ) {
    const providerBatch = providerEntries.slice(
      batchStart,
      batchStart + MODEL_PROVIDER_CONCURRENCY,
    );
    const settledModelRequests = await Promise.allSettled(
      providerBatch.map(([providerName, provider]) =>
        fetchProviderModels(
          providerName,
          provider,
          context.apiKeyIndex,
          aiGateway,
          clientGatewayHeaders,
        ),
      ),
    );

    for (const [index, settledRequest] of settledModelRequests.entries()) {
      const providerName = providerBatch[index][0];
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
        const serializedModel = JSON.stringify({
          id: `${providerName}/${id}`,
          ...model,
        });
        const modelBytes = utf8ByteLength(serializedModel);
        if (aggregatedBytes + modelBytes > MAX_AGGREGATED_MODELS_BYTES) {
          truncated = true;
          break;
        }
        serializedModels.push(serializedModel);
        aggregatedBytes += modelBytes;
      }
    }
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
    ...(truncated ? { "X-Proxy-Models-Truncated": "true" } : {}),
  };

  if (modelsCache === undefined) {
    return new Response(responseBody, { headers: responseHeaders });
  }

  // Degraded aggregates (a failed provider or a truncated list) are served but
  // never cached, so a transient upstream outage cannot pin an incomplete
  // model list for the full TTL.
  if (!providerFailed && !truncated) {
    const cachePutPromise = modelsCache.cache.put(
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

  return new Response(responseBody, {
    headers: { ...responseHeaders, "X-Proxy-Models-Cache": "MISS" },
  });
}
