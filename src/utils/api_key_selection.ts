import type { MiddlewareContext } from "../middleware";
import type { ProviderBase } from "../providers/provider";
import { Secrets } from "./secrets";

type ApiKeyFallback = "first" | "rotate";

/** Resolve an explicit key selection or apply the endpoint's fallback policy. */
export async function selectApiKeyIndex(
  provider: ProviderBase,
  selection: MiddlewareContext["apiKeyIndex"],
  fallback: ApiKeyFallback,
): Promise<number> {
  if (selection !== undefined) {
    return Secrets.resolveApiKeyIndex(selection, provider.getApiKeys().length);
  }
  return fallback === "rotate" ? provider.getNextApiKeyIndex() : 0;
}
