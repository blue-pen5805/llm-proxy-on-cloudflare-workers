import { AiGatewayEndpoint } from "../providers/ai_gateway";
import { Providers } from "../providers";
import { getPathname } from "../utils";

export async function proxy(request: Request, providerName: string) {
  const provider = Providers[providerName];
  const providerClass = new provider.providerClass(provider.args);
  if (AiGatewayEndpoint.isActive(providerName)) {
    providerClass.endpoint = new AiGatewayEndpoint(
      providerName,
      providerClass.endpoint,
    );
  }

  let pathname = getPathname(request).replace(
    new RegExp(`^/${providerName}/`),
    "/",
  );

  // Remove duplicated base path
  const endpointBasePath = new URL(providerClass.endpoint.baseUrl()).pathname;
  if (pathname.startsWith(endpointBasePath + endpointBasePath)) {
    pathname = pathname.replace(endpointBasePath, "");
  }

  return providerClass.fetch(pathname, {
    method: request.method,
    body: request.body,
    headers: request.headers,
  });
}
