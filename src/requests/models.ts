import { CloudflareAIGateway } from "../ai_gateway";
import { getAllProviders } from "../providers";
import { OpenAIModelsListResponseBody } from "../providers/openai/types";
import { ProviderNotSupportedError } from "../providers/provider";
import { Environments } from "../utils/environments";
import { fetch2 } from "../utils/helpers";

export async function models(
  aiGateway: CloudflareAIGateway | undefined = undefined,
) {
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

      // Always use the first API key for models endpoint
      const apiKeyIndex = 0;
      const [requestInfo, requestInit] =
        await providerInstance.buildModelsRequest(apiKeyIndex);

      if (aiGateway && CloudflareAIGateway.isSupportedProvider(providerName)) {
        const response = await fetch2(
          ...aiGateway.buildProviderEndpointRequest({
            provider: providerName,
            method: requestInit.method,
            path: requestInfo,
            headers: await providerInstance.headers(apiKeyIndex),
          }),
        );
        const models = await response.json();

        return providerInstance.modelsToOpenAIFormat(models);
      }

      // Request to the provider endpoint
      const response = await providerInstance.fetch(requestInfo, requestInit);
      const models = await response.json();

      // Convert models to OpenAI format
      return providerInstance.modelsToOpenAIFormat(models);
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
