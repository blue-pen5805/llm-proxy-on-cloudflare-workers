import {
  CLOUDFLARE_AI_GATEWAY_REST_API_PATHS,
  CLOUDFLARE_AI_GATEWAY_SUPPORTED_PROVIDERS,
  CloudflareAIGatewayOpenAICompatibleProvider,
  CloudflareAIGatewayProvider,
  CloudflareAIGatewayRestApiPath,
  OPENAI_COMPATIBLE_PROVIDERS,
} from "./const";

// Membership checks run several times per request, so the readonly tuples are
// mirrored into sets once at module load.
const CLOUDFLARE_AI_GATEWAY_SUPPORTED_PROVIDER_SET: ReadonlySet<string> =
  new Set(CLOUDFLARE_AI_GATEWAY_SUPPORTED_PROVIDERS);
const OPENAI_COMPATIBLE_PROVIDER_SET: ReadonlySet<string> = new Set(
  OPENAI_COMPATIBLE_PROVIDERS,
);
const CLOUDFLARE_AI_GATEWAY_REST_API_PATH_SET: ReadonlySet<string> = new Set(
  CLOUDFLARE_AI_GATEWAY_REST_API_PATHS,
);
const CLOUDFLARE_AI_PATH_PATTERN = /^\/ai(?:$|\/|\?)/;

export function isSafeCloudflareAccountId(accountId: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(accountId);
}

export function isSafeCloudflareAIGatewayId(gatewayId: string): boolean {
  return (
    gatewayId.length >= 1 &&
    gatewayId.length <= 64 &&
    gatewayId !== "." &&
    gatewayId !== ".." &&
    !/[\\/?#\u0000-\u001f\u007f]/.test(gatewayId)
  );
}

export function isCloudflareAIGatewayProvider(
  provider: string,
): provider is CloudflareAIGatewayProvider {
  return CLOUDFLARE_AI_GATEWAY_SUPPORTED_PROVIDER_SET.has(provider);
}

export function isCloudflareAIGatewayOpenAICompatibleProvider(
  provider: string,
): provider is CloudflareAIGatewayOpenAICompatibleProvider {
  return OPENAI_COMPATIBLE_PROVIDER_SET.has(provider);
}

export function isCloudflareAIGatewayRestApiPath(
  path: string,
): path is CloudflareAIGatewayRestApiPath {
  return CLOUDFLARE_AI_GATEWAY_REST_API_PATH_SET.has(path);
}

export function isCloudflareAiPath(path: string): boolean {
  return CLOUDFLARE_AI_PATH_PATTERN.test(path);
}
