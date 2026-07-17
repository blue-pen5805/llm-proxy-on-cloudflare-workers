import type { CloudflareAIGateway } from "../ai_gateway";
import type { MiddlewareContext } from "../middleware";
import { getProviderByName } from "../providers";
import type { ProviderBase } from "../providers/provider";
import { Environments } from "../utils/environments";

/** Resolve a provider from the request-scoped registry or the legacy fallback. */
export function resolveProvider(
  context: MiddlewareContext,
  providerName: string,
): ProviderBase | undefined {
  return context.providers
    ? context.providers.get(providerName)
    : getProviderByName(providerName, Environments.all());
}

/**
 * Return the existing endpoint-compatible error response when a provider is
 * known but cannot serve the current request configuration.
 */
export function createProviderConfigurationErrorResponse(
  providerName: string,
  provider: ProviderBase,
  aiGateway?: CloudflareAIGateway,
): Response | undefined {
  let error: string | undefined;

  if (provider.requiresAiGateway && !aiGateway) {
    error = `${providerName} requires Cloudflare AI Gateway.`;
  } else if (provider.requiresAuthenticatedAiGateway && !aiGateway?.apiKey) {
    error = `${providerName} requires CF_AIG_TOKEN.`;
  } else {
    error = provider.configurationError?.();
    if (
      !error &&
      provider.requiresProviderCredentials &&
      !provider.available()
    ) {
      error = `${providerName} requires ${String(provider.apiKeyName)}.`;
    }
  }

  if (!error) {
    return undefined;
  }

  return new Response(JSON.stringify({ error }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}
