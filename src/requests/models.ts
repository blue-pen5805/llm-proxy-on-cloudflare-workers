import { CloudflareAIGateway } from "../ai_gateway";
import { MiddlewareContext } from "../middleware";
import { getAllProviders } from "../providers";
import { OpenAIModelsListResponseBody } from "../providers/openai/types";
import { ProviderBase, ProviderNotSupportedError } from "../providers/provider";
import {
  apiKeySelectionPolicy,
  recordApiKeySelection,
  selectApiKeyIndex,
} from "../utils/api_key_selection";
import { Environments } from "../utils/environments";
import { fetch2, withTimeout } from "../utils/helpers";
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
  if (!provider.available() && !aiGateway) {
    return EMPTY_MODELS;
  }

  const staticModels = provider.staticModels();
  if (staticModels) {
    return staticModels;
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
    selectionPolicy: apiKeySelectionPolicy(selection, "first"),
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
      fetch2(gatewayUrl, {
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

  const modelsPromise = responsePromise.then(async (response) =>
    provider.modelsToOpenAIFormat(await response.json()),
  );
  return withTimeout(
    modelsPromise,
    abortController,
    PROVIDER_FETCH_TIMEOUT_MS,
    providerName,
  );
}

export async function models(
  context: MiddlewareContext,
  aiGateway: CloudflareAIGateway | undefined = undefined,
) {
  const providerEntries = Object.entries(
    context.providers?.all() ?? getAllProviders(Environments.all()),
  );
  const requests = providerEntries.map(([providerName, provider]) =>
    fetchProviderModels(providerName, provider, context.apiKeyIndex, aiGateway),
  );

  const responses = await Promise.allSettled(requests);
  const models = responses.map((response, index) => {
    const provider = providerEntries[index][0];

    if (response.status === "rejected") {
      if (response.reason instanceof ProviderNotSupportedError) {
        return [];
      }

      RequestLogger.error("provider.models.failed", response.reason, {
        provider,
      });
      return [];
    }
    if (!response.value?.data) {
      RequestLogger.warn("provider.models.invalid_response", { provider });
      return [];
    }

    return response.value.data.map(({ id, ...model }) => ({
      id: `${provider}/${id}`,
      ...model,
    }));
  });

  return new Response(
    JSON.stringify({
      data: models.flat(),
      object: "list",
    }),
    {
      headers: {
        "Content-Type": "application/json",
      },
    },
  );
}
