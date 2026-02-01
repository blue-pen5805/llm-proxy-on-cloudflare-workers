import { CloudflareAIGateway } from "../ai_gateway";
import { MiddlewareContext } from "../middleware";
import { getAllProviders } from "../providers";
import { OpenAIModelsListResponseBody } from "../providers/openai/types";
import { ProviderNotSupportedError } from "../providers/provider";
import { Environments } from "../utils/environments";
import { fetch2, withTimeout } from "../utils/helpers";
import { Secrets } from "../utils/secrets";

// Timeout for individual provider model fetch operations (milliseconds)
const PROVIDER_FETCH_TIMEOUT_MS = 5000;

export async function models(
  context: MiddlewareContext,
  aiGateway: CloudflareAIGateway | undefined = undefined,
) {
  const { apiKeyIndex: contextApiKeyIndex } = context;
  const env = Environments.all();
  const allProviders = getAllProviders(env);
  const requests = Object.entries(allProviders).map(
    async ([providerName, providerInstance]) => {
      // Return empty list if the provider is not available
      if (providerInstance.available() === false) {
        return {
          object: "list",
          data: [],
        } as OpenAIModelsListResponseBody;
      }

      // Generate models request

      // Check for static models
      const staticModels = providerInstance.staticModels();
      if (staticModels) {
        return staticModels;
      }

      // Use the provided API key index if available, otherwise default to 0
      const apiKeyIndex =
        contextApiKeyIndex !== undefined
          ? Secrets.resolveApiKeyIndex(
              contextApiKeyIndex,
              providerInstance.getApiKeys().length,
            )
          : 0;
      const [requestInfo, requestInit] =
        await providerInstance.buildModelsRequest(apiKeyIndex);

      let models: OpenAIModelsListResponseBody;
      if (aiGateway && CloudflareAIGateway.isSupportedProvider(providerName)) {
        // Request through AI Gateway with timeout
        const abortController = new AbortController();
        const [gatewayUrl, gatewayInit] =
          aiGateway.buildProviderEndpointRequest({
            provider: providerName,
            method: requestInit.method,
            path: requestInfo,
            headers: await providerInstance.headers(apiKeyIndex),
          });

        const fetchPromise = fetch2(gatewayUrl, {
          ...gatewayInit,
          signal: abortController.signal,
        }).then(async (response) => {
          const responseJson = await response.json();
          return providerInstance.modelsToOpenAIFormat(responseJson);
        });

        try {
          models = await withTimeout(
            fetchPromise,
            abortController,
            PROVIDER_FETCH_TIMEOUT_MS,
            providerName,
          );
        } catch (error) {
          // Re-throw the error to be handled by Promise.allSettled
          throw error;
        }
      } else {
        // Direct request to provider endpoint with timeout
        const abortController = new AbortController();
        const fetchPromise = providerInstance
          .fetch(
            requestInfo,
            { ...requestInit, signal: abortController.signal },
            apiKeyIndex,
          )
          .then(async (response) => {
            const responseJson = await response.json();
            return providerInstance.modelsToOpenAIFormat(responseJson);
          });

        try {
          models = await withTimeout(
            fetchPromise,
            abortController,
            PROVIDER_FETCH_TIMEOUT_MS,
            providerName,
          );
        } catch (error) {
          // Re-throw the error to be handled by Promise.allSettled
          throw error;
        }
      }

      return models;
    },
  );

  const responses = await Promise.allSettled(requests);
  const models = responses.map((response, index) => {
    const provider = Object.keys(allProviders)[index];

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
    if (
      response.status === "fulfilled" &&
      (!response.value || !response.value?.data)
    ) {
      console.error(
        `Invalid response for provider ${provider}:`,
        response.value,
      );
      return [];
    }

    const fulfilledResponse =
      response as PromiseFulfilledResult<OpenAIModelsListResponseBody>;
    return fulfilledResponse.value.data.map(({ id, ...model }) => ({
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
