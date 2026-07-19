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
import { Environments } from "../utils/environments";
import {
  fetchWithLogging,
  readResponseJson,
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

const EMPTY_MODELS: OpenAIModelsListResponseBody = {
  object: "list",
  data: [],
};

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
  const providerEntries = Object.entries(
    context.providers?.all() ?? getAllProviderInstances(Environments.all()),
  );
  const providerModels: OpenAIModelsListResponseBody["data"] = [];
  const textEncoder = new TextEncoder();
  let aggregatedBytes = 0;
  let truncated = false;

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
          RequestLogger.error("provider.models.failed", settledRequest.reason, {
            provider: providerName,
          });
        }
        continue;
      }
      if (!Array.isArray(settledRequest.value?.data)) {
        RequestLogger.warn("provider.models.invalid_response", {
          provider: providerName,
        });
        continue;
      }

      for (const { id, ...model } of settledRequest.value.data.slice(
        0,
        MAX_MODELS_PER_PROVIDER,
      )) {
        const prefixedModel = { id: `${providerName}/${id}`, ...model };
        const modelBytes = textEncoder.encode(
          JSON.stringify(prefixedModel),
        ).length;
        if (aggregatedBytes + modelBytes > MAX_AGGREGATED_MODELS_BYTES) {
          truncated = true;
          break;
        }
        providerModels.push(prefixedModel);
        aggregatedBytes += modelBytes;
      }
    }
  }

  if (truncated) {
    RequestLogger.warn("provider.models.aggregate_truncated", {
      maximum_bytes: MAX_AGGREGATED_MODELS_BYTES,
    });
  }

  return new Response(
    JSON.stringify({
      data: providerModels,
      object: "list",
    }),
    {
      headers: {
        "Content-Type": "application/json",
        ...(truncated ? { "X-Proxy-Models-Truncated": "true" } : {}),
      },
    },
  );
}
