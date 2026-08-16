import { CloudflareAIGateway } from "../ai_gateway";
import { MiddlewareContext } from "../middleware";
import { getAllProviders } from "../providers";
import { OpenAIModelsListResponseBody } from "../providers/openai/types";
import { ProviderBase, ProviderNotSupportedError } from "../providers/provider";
import { selectApiKeyIndex } from "../utils/api_key_selection";
import { Environments } from "../utils/environments";
import { fetch2, withTimeout } from "../utils/helpers";

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
  if (!provider.available()) {
    return EMPTY_MODELS;
  }

  const staticModels = provider.staticModels();
  if (staticModels) {
    return staticModels;
  }

  const apiKeyIndex = await selectApiKeyIndex(provider, selection, "first");
  const [path, init] = await provider.buildModelsRequest(apiKeyIndex);
  const abortController = new AbortController();

  let responsePromise: Promise<Response>;
  if (aiGateway && CloudflareAIGateway.isSupportedProvider(providerName)) {
    const [gatewayUrl, gatewayInit] = aiGateway.buildProviderEndpointRequest({
      provider: providerName,
      method: init.method,
      path,
      headers: await provider.headers(apiKeyIndex),
    });
    responsePromise = fetch2(gatewayUrl, {
      ...gatewayInit,
      signal: abortController.signal,
    });
  } else {
    responsePromise = provider.fetch(
      path,
      { ...init, signal: abortController.signal },
      apiKeyIndex,
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
  const providerEntries = Object.entries(getAllProviders(Environments.all()));
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

      console.error(
        `Error fetching models for provider ${provider}:`,
        response.reason,
      );
      return [];
    }
    if (!response.value?.data) {
      console.error(
        `Invalid response for provider ${provider}:`,
        response.value,
      );
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
