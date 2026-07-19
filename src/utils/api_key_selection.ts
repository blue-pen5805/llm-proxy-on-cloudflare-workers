import type { MiddlewareContext } from "../middleware";
import type { ProviderBase } from "../providers/provider";
import type { LogFields } from "./logger";
import { RequestLogger } from "./logger";
import { Secrets } from "./secrets";

export type ApiKeyFallback = "first" | "rotate";
export type ApiKeySelectionPolicy =
  | "automatic_rotation"
  | "default_first"
  | "diagnostic_scan"
  | "explicit_index"
  | "explicit_range";

interface ApiKeySelectionLogOptions {
  provider: string;
  operation: string;
  keyIndex: number;
  keyCount: number;
  selectionPolicy: ApiKeySelectionPolicy;
  viaAiGateway: boolean;
  providerRequestId?: string;
  step?: number;
}

export function determineApiKeySelectionPolicy(
  selection: MiddlewareContext["apiKeyIndex"],
  fallback: ApiKeyFallback,
): ApiKeySelectionPolicy {
  if (typeof selection === "number") return "explicit_index";
  if (selection !== undefined) return "explicit_range";
  return fallback === "rotate" ? "automatic_rotation" : "default_first";
}

/**
 * Records which credential slot was selected without ever reading or logging
 * the credential value. Returns fields that can be attached to its subrequest.
 */
export function recordApiKeySelection({
  provider,
  operation,
  keyIndex,
  keyCount,
  selectionPolicy,
  viaAiGateway,
  providerRequestId = crypto.randomUUID(),
  step,
}: ApiKeySelectionLogOptions): LogFields {
  const hasKey = keyCount > 0;
  const fields: LogFields = {
    provider_request_id: providerRequestId,
    provider,
    operation,
    key_index: hasKey ? keyIndex : null,
    key_count: keyCount,
    credential_configured: hasKey,
    selection_policy: selectionPolicy,
    via_ai_gateway: viaAiGateway,
    step,
  };

  RequestLogger.info(
    "provider.key.selected",
    "Provider credential selected",
    fields,
  );
  return fields;
}

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
