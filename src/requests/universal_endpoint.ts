import { CloudflareAIGateway } from "../ai_gateway";
import {
  CloudflareAIGatewayUniversalEndpointData,
  CloudflareAIGatewayUniversalEndpointStep,
} from "../ai_gateway/const";
import { isCloudflareAIGatewayProvider } from "../ai_gateway/utils";
import { Providers } from "../providers";
import { recordApiKeySelection } from "../utils/api_key_selection";
import { fetch2 } from "../utils/helpers";
import { Secrets } from "../utils/secrets";

type UniversalEndpointRequest = {
  provider?: string;
  endpoint?: string;
  headers?: { [key: string]: string };
  query: {
    model?: string;
    [key: string]: unknown;
  };
};

export async function universalEndpoint(
  request: Request,
  aiGateway: CloudflareAIGateway,
) {
  const items: UniversalEndpointRequest[] = await request.json();

  const mappedItems: CloudflareAIGatewayUniversalEndpointData =
    await Promise.all(
      items.map(
        async (
          item,
          step,
        ): Promise<CloudflareAIGatewayUniversalEndpointStep> => {
          const providerName = item.provider;
          if (!providerName) {
            throw new Error(`Provider not specified.`);
          }
          if (isCloudflareAIGatewayProvider(providerName) === false) {
            throw new Error(`Provider ${providerName} is not supported.`);
          }
          const provider = Providers[providerName];
          const providerClass = new provider();
          const endpoint =
            item.endpoint || providerClass.chatCompletionPath.replace("/", "");
          const apiKeyName = providerClass.apiKeyName as keyof Env;
          const apiKeyIndex = await Secrets.getNext(apiKeyName);
          recordApiKeySelection({
            provider: providerName,
            operation: "universal_endpoint",
            keyIndex: apiKeyIndex,
            keyCount: Secrets.getAll(apiKeyName).length,
            selectionPolicy: "automatic_rotation",
            viaAiGateway: true,
            step,
          });
          const headers = {
            ...(await providerClass.headers(apiKeyIndex)),
            ...item.headers,
          };
          const query = item.query;

          return {
            provider: providerName,
            endpoint,
            headers,
            query,
          };
        },
      ),
    );

  const [requestInfo, requestInit] = aiGateway.buildUniversalEndpointRequest({
    data: mappedItems,
  });
  return fetch2(requestInfo, { ...requestInit, signal: request.signal });
}
