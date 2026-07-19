import { CloudflareAIGateway } from ".";
import type { Provider } from "../providers/provider";

const CUSTOM_PROVIDER_SLUG_PREFIX = "llm-proxy-";
const CUSTOM_PROVIDER_VERSION_SENTINEL = "v1";

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
  const versionSegment = pathname.match(/\/(v[^/]+)$/)?.[1];
  const requestPathPrefix = versionSegment ? `/${versionSegment}` : "";
  baseUrl.pathname = versionSegment
    ? pathname
    : `${pathname}/${CUSTOM_PROVIDER_VERSION_SENTINEL}`;
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
 * Compensate for AI Gateway's version-segment rewriting on Custom routes while
 * retaining native-provider path conversion for native routes.
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
