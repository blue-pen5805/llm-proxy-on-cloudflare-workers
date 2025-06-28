import { request } from "http";
import { CloudflareAIGateway } from "../ai_gateway";
import { Providers } from "../providers";
import { OpenAIModelsListResponseBody } from "../providers/openai/types";
import { fetch2 } from "../utils/helpers";
import { ProviderNotSupportedError } from "../providers/provider";

export async function models(
  aiGateway: CloudflareAIGateway | undefined = undefined,
) {
  const requests = Object.keys(Providers).map(async (providerName) => {
    const provider = Providers[providerName];
    const providerClass = new provider.providerClass();

    // Return empty list if the provider is not available
    if (providerClass.available() === false) {
      return Promise.resolve({
        object: "list",
        data: [],
      } as OpenAIModelsListResponseBody);
    }

    // Generate models request
    const [requestInfo, requestInit] = providerClass.buildModelsRequest();

    // If AI Gateway is enabled and the provider supports it, use AI Gateway
    if (aiGateway && CloudflareAIGateway.isSupportedProvider(providerName)) {
      const response = await fetch2(
        ...aiGateway.buildProviderEndpointRequest({
          provider: providerName,
          method: requestInit.method,
          path: requestInfo,
          headers: providerClass.endpoint.headers(),
        }),
      );
      const models = await response.json();

      return providerClass.modelsToOpenAIFormat(models);
    }

    // Request to the provider endpoint
    const response = await providerClass.fetch(requestInfo, requestInit);
    const models = await response.json();

    // Convert models to OpenAI format
    return providerClass.modelsToOpenAIFormat(models);
  });

  const responses = await Promise.allSettled(requests);
  const models = responses.map((response, index) => {
    const provider = Object.keys(Providers)[index];

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
