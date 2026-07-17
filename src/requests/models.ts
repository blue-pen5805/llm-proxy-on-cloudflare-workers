import { CloudflareAIGateway } from "../ai_gateway";
import { MiddlewareContext } from "../middleware";
import { getAllProviderInstances } from "../providers";
import { OpenAIModelsListResponseBody } from "../providers/openai/types";
import { ProviderBase, ProviderNotSupportedError } from "../providers/provider";
import {
  determineApiKeySelectionPolicy,
  recordApiKeySelection,
  selectApiKeyIndex,
} from "../utils/api_key_selection";
import { Environments } from "../utils/environments";
import { fetchWithLogging, withTimeout } from "../utils/helpers";
import { RequestLogger } from "../utils/logger";

// Timeout for individual provider model fetch operations (milliseconds)
const PROVIDER_FETCH_TIMEOUT_MS = 5000;

const EMPTY_MODELS: OpenAIModelsListResponseBody = {
  object: "list",
  data: [],
};

async function fetchProviderModels(
  providerName: string,
  provider: ProviderBase,
  selection: MiddlewareContext["apiKeyIndex"],
  aiGateway?: CloudflareAIGateway,
): Promise<OpenAIModelsListResponseBody> {
  if (
    !provider.available() &&
    (!aiGateway || provider.supportsAiGatewayModels === false)
  ) {
    return EMPTY_MODELS;
  }

  const getStaticModels = provider.getStaticModels();
  if (getStaticModels) {
    return getStaticModels;
  }

  const apiKeyIndex = await selectApiKeyIndex(provider, selection, "first");
  const aiGatewayProvider =
    aiGateway && CloudflareAIGateway.isSupportedProvider(providerName)
      ? providerName
      : undefined;
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
  if (
    aiGateway &&
    aiGatewayProvider &&
    provider.supportsAiGatewayModels !== false
  ) {
    const [gatewayUrl, gatewayInit] = aiGateway.buildProviderEndpointRequest({
      provider: aiGatewayProvider,
      method: init.method,
      path: provider.aiGatewayPath?.(path) ?? path,
      headers: await provider.headers(apiKeyIndex),
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

  const modelsPromise = responsePromise.then(async (upstreamResponse) =>
    provider.convertModelsToOpenAIFormat(await upstreamResponse.json()),
  );
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
  const providerEntries = Object.entries(
    context.providers?.all() ?? getAllProviderInstances(Environments.all()),
  );
  const modelRequests = providerEntries.map(([providerName, provider]) =>
    fetchProviderModels(providerName, provider, context.apiKeyIndex, aiGateway),
  );

  const settledModelRequests = await Promise.allSettled(modelRequests);
  const providerModels = settledModelRequests.map((settledRequest, index) => {
    const providerName = providerEntries[index][0];

    if (settledRequest.status === "rejected") {
      if (settledRequest.reason instanceof ProviderNotSupportedError) {
        return [];
      }

      RequestLogger.error("provider.models.failed", settledRequest.reason, {
        provider: providerName,
      });
      return [];
    }
    if (!settledRequest.value?.data) {
      RequestLogger.warn("provider.models.invalid_response", {
        provider: providerName,
      });
      return [];
    }

    return settledRequest.value.data.map(({ id, ...model }) => ({
      id: `${providerName}/${id}`,
      ...model,
    }));
  });

  return new Response(
    JSON.stringify({
      data: providerModels.flat(),
      object: "list",
    }),
    {
      headers: {
        "Content-Type": "application/json",
      },
    },
  );
}
