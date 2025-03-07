import { AiGatewayEndpoint } from "../providers/ai_gateway";
import { Providers } from "../providers";

export async function proxy(
  request: Request,
  providerName: string,
  pathname: string,
) {
  const provider = Providers[providerName];
  const providerClass = new provider.providerClass(provider.args);
  if (AiGatewayEndpoint.isActive(providerName)) {
    providerClass.endpoint = new AiGatewayEndpoint(
      providerName,
      providerClass.endpoint,
    );
  }

  let targetPathname = pathname.replace(new RegExp(`^/${providerName}/`), "/");

  // Remove duplicated base path
  const endpointBasePath = new URL(providerClass.endpoint.baseUrl()).pathname;
  if (targetPathname.startsWith(endpointBasePath + endpointBasePath)) {
    targetPathname = targetPathname.replace(endpointBasePath, "");
  }

  return providerClass.fetch(targetPathname, {
    method: request.method,
    body: request.body,
    headers: request.headers,
  });
}
