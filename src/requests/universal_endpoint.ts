import { AiGatewayEndpoint } from "../providers/ai_gateway";
import { Providers } from "../providers";
import { ProviderBase } from "../providers/provider";

type UniversalEndpointItem = {
  provider?: string;
  endpoint?: string;
  headers?: { [key: string]: string };
  query: {
    model?: string;
    [key: string]: any;
  };
};

export async function universalEndpoint(request: Request) {
  const data = (await request.json()) as UniversalEndpointItem[];

  const body = data.map((item) => modifyUniversalEndpointItem(item));

  const endpoint = new AiGatewayEndpoint();
  return await endpoint.fetch("", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function modifyUniversalEndpointItem(item: UniversalEndpointItem) {
  if (item.provider) {
    const providerName = item.provider;
    const provider = Providers[providerName];
    const providerClass = new provider.providerClass();
    const model = item.query.model || "";
    const endpoint =
      item.endpoint ||
      providerClass.chatCompletionPath.replace("/", "") ||
      "/chat/completions";
    const headers = item.headers || providerClass.endpoint.headers();

    return {
      provider: providerName,
      endpoint,
      headers,
      query: {
        ...item.query,
        model,
      },
    };
  } else {
    const [providerName, ...modelParts] = item.query.model?.split("/") as [
      string,
      string[],
    ];
    const model = modelParts.join("/");

    const provider = Providers[providerName];
    if (!provider) {
      return {};
    }
    const providerClass = new provider.providerClass();
    const endpoint =
      item.endpoint ||
      providerClass.chatCompletionPath.replace("/", "") ||
      "/chat/completions";
    const headers = item.headers || providerClass?.endpoint?.headers();

    return {
      provider: providerName,
      endpoint,
      headers,
      query: {
        ...item.query,
        model,
      },
    };
  }
}

export function requestToUniversalEndpointItem(
  providerName: string,
  providerClass: ProviderBase,
  requestData: Parameters<typeof fetch>[1],
) {
  const endpoint =
    providerClass.chatCompletionPath.replace("/", "") || "/chat/completions";

  return {
    provider: providerName,
    endpoint,
    headers: requestData ? requestData.headers : {},
    query: requestData ? JSON.parse(requestData.body as string) : undefined,
  };
}
