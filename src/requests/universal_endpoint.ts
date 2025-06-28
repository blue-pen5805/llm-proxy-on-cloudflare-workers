import { CloudflareAIGateway } from "../ai_gateway";
import {
  CloudflareAIGatewayUniversalEndpointData,
  CloudflareAIGatewayUniversalEndpointStep,
} from "../ai_gateway/const";
import { isCloudflareAIGatewayProvider } from "../ai_gateway/utils";
import { Providers } from "../providers";
import { fetch2 } from "../utils/helpers";

type UniversalEndpointRequest = {
  provider?: string;
  endpoint?: string;
  headers?: { [key: string]: string };
  query: {
    model?: string;
    [key: string]: any;
  };
};

export async function universalEndpoint(
  request: Request,
  aiGateway: CloudflareAIGateway,
) {
  const items: UniversalEndpointRequest[] = await request.json();

  const mappedItems: CloudflareAIGatewayUniversalEndpointData = items.map(
    (item): CloudflareAIGatewayUniversalEndpointStep => {
      const providerName = item.provider;
      if (!providerName) {
        throw new Error(`Provider not specified.`);
      }
      if (isCloudflareAIGatewayProvider(providerName) === false) {
        throw new Error(`Provider ${providerName} is not supported.`);
      }
      const provider = Providers[providerName];
      const providerClass = new provider.providerClass();
      const endpoint =
        item.endpoint || providerClass.chatCompletionPath.replace("/", "");
      const headers = { ...providerClass.endpoint.headers(), ...item.headers };
      const query = item.query;

      return {
        provider: providerName,
        endpoint,
        headers,
        query,
      };
    },
  );

  return await fetch2(
    ...aiGateway.buildUniversalEndpointRequest({
      data: mappedItems,
    }),
  );
}
