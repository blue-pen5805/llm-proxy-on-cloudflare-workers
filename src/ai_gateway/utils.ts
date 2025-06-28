import {
  CLOUDFLARE_AI_GATEWAY_SUPPORTED_PROVIDERS,
  CloudflareAIGatewayOpenAICompatibleProvider,
  CloudflareAIGatewayProvider,
  OPENAI_COMPATIBLE_PROVIDERS,
} from "./const";

export function isCloudflareAIGatewayProvider(
  provider: string,
): provider is CloudflareAIGatewayProvider {
  return Object.values(CLOUDFLARE_AI_GATEWAY_SUPPORTED_PROVIDERS).includes(
    provider as CloudflareAIGatewayProvider,
  );
}

export function isCloudflareAIGatewayOpenAICompatibleProvider(
  provider: string,
): provider is CloudflareAIGatewayOpenAICompatibleProvider {
  return OPENAI_COMPATIBLE_PROVIDERS.includes(
    provider as CloudflareAIGatewayOpenAICompatibleProvider,
  );
}
