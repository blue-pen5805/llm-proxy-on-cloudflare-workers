import { CloudflareAIGateway } from "../ai_gateway";
import {
  CloudflareAIGatewayUniversalEndpointData,
  CloudflareAIGatewayUniversalEndpointStep,
} from "../ai_gateway/const";
import { isCloudflareAIGatewayProvider } from "../ai_gateway/utils";
import { BUILT_IN_PROVIDER_CONSTRUCTORS } from "../providers";
import { recordApiKeySelection } from "../utils/api_key_selection";
import { fetchWithLogging } from "../utils/helpers";
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

export async function handleUniversalEndpointRequest(
  request: Request,
  aiGateway: CloudflareAIGateway,
) {
  const endpointRequests: UniversalEndpointRequest[] = await request.json();

  const gatewaySteps: CloudflareAIGatewayUniversalEndpointData =
    await Promise.all(
      endpointRequests.map(
        async (
          endpointRequest,
          stepIndex,
        ): Promise<CloudflareAIGatewayUniversalEndpointStep> => {
          const providerName = endpointRequest.provider;
          if (!providerName) {
            throw new Error(`Provider not specified.`);
          }
          if (isCloudflareAIGatewayProvider(providerName) === false) {
            throw new Error(`Provider ${providerName} is not supported.`);
          }
          const ProviderConstructor =
            BUILT_IN_PROVIDER_CONSTRUCTORS[providerName];
          const providerInstance = new ProviderConstructor();
          const endpointPath =
            endpointRequest.endpoint ||
            providerInstance.chatCompletionPath.replace("/", "");
          const apiKeyName = providerInstance.apiKeyName as keyof Env;
          const apiKeyIndex = await Secrets.getNext(apiKeyName);
          recordApiKeySelection({
            provider: providerName,
            operation: "universal_endpoint",
            keyIndex: apiKeyIndex,
            keyCount: Secrets.getAll(apiKeyName).length,
            selectionPolicy: "automatic_rotation",
            viaAiGateway: true,
            step: stepIndex,
          });
          const requestHeaders = {
            ...(await providerInstance.headers(apiKeyIndex)),
            ...endpointRequest.headers,
          };

          return {
            provider: providerName,
            endpoint: endpointPath,
            headers: requestHeaders,
            query: endpointRequest.query,
          };
        },
      ),
    );

  const [requestInfo, requestInit] = aiGateway.buildUniversalEndpointRequest({
    data: gatewaySteps,
  });
  return fetchWithLogging(requestInfo, {
    ...requestInit,
    signal: request.signal,
  });
}
