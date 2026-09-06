import { CloudflareAIGateway } from "../ai_gateway";
import { resolveGatewayProvider } from "../ai_gateway/custom_provider";
import type { ModelsEndpoint } from "../providers/models";
import type { ProviderBase } from "../providers/provider";

/** Resolve whether model discovery for a provider may use AI Gateway. */
export function resolveAiGatewayModelsProvider(
  providerName: string,
  provider: Pick<ProviderBase, "requiresCustomAiGatewayProvider">,
  models: ModelsEndpoint,
  aiGateway?: CloudflareAIGateway,
): string | undefined {
  const nativeSupported =
    !provider.requiresCustomAiGatewayProvider &&
    models.supportsAiGateway !== false &&
    CloudflareAIGateway.isSupportedProvider(providerName);
  return resolveGatewayProvider(providerName, aiGateway, nativeSupported);
}
