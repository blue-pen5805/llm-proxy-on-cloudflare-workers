import { CloudflareAIGateway } from "../ai_gateway";
import type { CloudflareAIGatewayProvider } from "../ai_gateway/const";
import type { ProviderBase } from "../providers/provider";

/** Resolve whether model discovery for a provider may use AI Gateway. */
export function resolveAiGatewayModelsProvider(
  providerName: string,
  provider: Pick<ProviderBase, "supportsAiGatewayModels">,
  aiGateway?: CloudflareAIGateway,
): CloudflareAIGatewayProvider | undefined {
  return aiGateway &&
    provider.supportsAiGatewayModels !== false &&
    CloudflareAIGateway.isSupportedProvider(providerName)
    ? providerName
    : undefined;
}
