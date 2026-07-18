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

interface CustomProviderUrlParts {
  baseUrl: string;
  requestPathPrefix: string;
}

function customProviderUrlParts(
  provider: Pick<Provider, "baseUrl">,
): CustomProviderUrlParts {
  const baseUrl = new URL(provider.baseUrl());
  const pathname = baseUrl.pathname.replace(/\/+$/, "");
  const requestPathPrefix = pathname.endsWith("/v1") ? "/v1" : "";
  const registeredPathname = requestPathPrefix
    ? pathname.slice(0, -requestPathPrefix.length)
    : pathname;
  baseUrl.pathname = `${registeredPathname}/`;
  return { baseUrl: baseUrl.href, requestPathPrefix };
}

/** Return the Base URL stored in an AI Gateway Custom Provider. */
export function customProviderBaseUrl(
  provider: Pick<Provider, "baseUrl">,
): string {
  return customProviderUrlParts(provider).baseUrl;
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
 * AI Gateway replaces a trailing /v1 Base URL segment while resolving a Custom
 * Provider path. Store that segment in the request path for Custom routes only.
 */
export function gatewayProviderPath(
  providerName: string,
  provider: Pick<Provider, "aiGatewayPath" | "baseUrl" | "pathnamePrefix">,
  pathname: string,
  gatewayProvider: string,
): string {
  if (gatewayProvider === providerName) {
    return provider.aiGatewayPath?.(pathname) ?? pathname;
  }

  const { requestPathPrefix } = customProviderUrlParts(provider);
  return `${requestPathPrefix}${provider.pathnamePrefix?.() ?? ""}${pathname}`;
}
