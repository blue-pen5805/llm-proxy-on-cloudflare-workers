import { CloudflareAIGateway } from ".";
import type { Provider } from "../providers/provider";

const CUSTOM_PROVIDER_SLUG_PREFIX = "llm-proxy-";

function hashProviderName(providerName: string): string {
  let hash = 0x811c9dc5;
  for (const character of providerName) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Return the account-level slug stored in Cloudflare Custom Providers. */
export function customProviderSlug(providerName: string): string {
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(providerName)) {
    return `${CUSTOM_PROVIDER_SLUG_PREFIX}${providerName}`;
  }

  const normalizedName =
    providerName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "provider";
  return `${CUSTOM_PROVIDER_SLUG_PREFIX}${normalizedName}-${hashProviderName(providerName)}`;
}

/** Return the provider segment used in an AI Gateway request URL. */
export function customProviderRoute(providerName: string): string {
  return `custom-${customProviderSlug(providerName)}`;
}

export function resolveGatewayProvider(
  providerName: string,
  aiGateway: CloudflareAIGateway | undefined,
  nativeSupported: boolean = CloudflareAIGateway.isSupportedProvider(
    providerName,
  ),
): string | undefined {
  if (!aiGateway) return undefined;
  if (nativeSupported) return providerName;
  return aiGateway.alwaysUse ? customProviderRoute(providerName) : undefined;
}

/**
 * Custom Providers store provider.baseUrl() as their base URL, so the Gateway
 * request must retain the adapter's fixed pathname prefix.
 */
export function gatewayProviderPath(
  providerName: string,
  provider: Pick<Provider, "aiGatewayPath" | "pathnamePrefix">,
  pathname: string,
  gatewayProvider: string,
): string {
  return gatewayProvider === providerName
    ? (provider.aiGatewayPath?.(pathname) ?? pathname)
    : `${provider.pathnamePrefix?.() ?? ""}${pathname}`;
}
