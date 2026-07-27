import type { CloudflareAIGateway } from "../ai_gateway";
import type { MiddlewareContext } from "../middleware";
import { getProviderByName } from "../providers";
import type { ProviderBase } from "../providers/provider";
import { Environments } from "../utils/environments";
import { RequestLogger } from "../utils/logger";
import { openAIErrorResponse } from "./error_response";

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
      // Keep the internal credential variable name (e.g. OPENAI_API_KEY) in
      // operator logs only; the client sees a generic message so the proxy does
      // not disclose its environment variable names.
      RequestLogger.warn(
        "provider.credential.missing",
        "Provider credential is not configured",
        { provider: providerName, credential: String(provider.apiKeyName) },
      );
      error = `${providerName} is not configured.`;
    }
  }

  if (!error) {
    return undefined;
  }

  return openAIErrorResponse(error, 400);
}
