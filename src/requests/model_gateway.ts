import { CloudflareAIGateway } from "../ai_gateway";
import { resolveGatewayProvider } from "../ai_gateway/custom_provider";
import type { ProviderBase } from "../providers/provider";

/** Resolve whether model discovery for a provider may use AI Gateway. */
export function resolveAiGatewayModelsProvider(
  providerName: string,
  provider: Pick<
    ProviderBase,
    "supportsAiGatewayModels" | "requiresCustomAiGatewayProvider"
  >,
  aiGateway?: CloudflareAIGateway,
): string | undefined {
  const nativeSupported =
    !provider.requiresCustomAiGatewayProvider &&
    provider.supportsAiGatewayModels !== false &&
    CloudflareAIGateway.isSupportedProvider(providerName);
  return resolveGatewayProvider(providerName, aiGateway, nativeSupported);
}
