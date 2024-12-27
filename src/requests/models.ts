import { AiGatewayEndpoint } from "../providers/ai_gateway";
import { Providers } from "../providers";
import { OpenAIModelsListResponseBody } from "../providers/openai/types";

export async function models() {
  const requests = Object.keys(Providers).map((providerName) => {
    const provider = Providers[providerName];
    const providerClass = new provider.providerClass(provider.args);
    if (providerClass.available() === false) {
      return Promise.resolve({
        object: "list",
        data: [],
      } as OpenAIModelsListResponseBody);
    }

    if (AiGatewayEndpoint.isActive(providerName)) {
      providerClass.endpoint = new AiGatewayEndpoint(
        providerName,
        providerClass.endpoint,
      );
    }
    return providerClass.listModels();
  });

  const responses = await Promise.allSettled(requests);
  const models = responses.map((response, index) => {
    const provider = Object.keys(Providers)[index];
    if (response.status === "rejected" || response.value.data === undefined) {
      console.warn(`Failed to fetch models for ${provider}.`);
      if ("reason" in response) {
        console.error(response.reason);
      }

      return [];
    }

    return response.value.data.map(({ id, ...model }) => ({
      id: `${Object.keys(Providers)[index]}/${id}`,
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
