import type { ProviderBase } from "../providers/provider";
import type { ApiKeySelection } from "../request_context";
import { Config } from "./config";
import type { LogFields } from "./logger";
import { RequestLogger } from "./logger";
import { Secrets } from "./secrets";

// Cooldowns deliberately share the same isolate-local consistency model as
// striped rotation. They improve immediate reuse within a warm isolate without
// adding storage or a coordination round trip to every provider request.
const apiKeyCooldowns = new Map<string, Map<number, number>>();
const COOLDOWN_STATUSES = new Set([401, 403, 429]);

function shouldCoolDown(status: number): boolean {
  return COOLDOWN_STATUSES.has(status) || status >= 500;
}

/**
 * Return non-cooled slots. `undefined` means every slot is eligible and avoids
 * allocating an index array on the ordinary no-cooldown request path.
 */
export function getEligibleApiKeyIndexes(
  provider: string,
  keyCount: number,
  now: number = Date.now(),
): number[] | undefined {
  if (keyCount <= 1) return undefined;

  const providerCooldowns = apiKeyCooldowns.get(provider);
  if (!providerCooldowns) return undefined;

  for (const [index, expiresAt] of providerCooldowns) {
    if (index >= keyCount || expiresAt <= now) providerCooldowns.delete(index);
  }
  if (providerCooldowns.size === 0) {
    apiKeyCooldowns.delete(provider);
    return undefined;
  }

  const eligible: number[] = [];
  for (let index = 0; index < keyCount; index++) {
    if ((providerCooldowns.get(index) ?? 0) <= now) eligible.push(index);
  }
  return eligible.length > 0 ? eligible : undefined;
}

/** Record an attributable upstream response without reading credential data. */
export function recordApiKeyOutcome(
  provider: string,
  keyIndex: number,
  keyCount: number,
  status: number,
): void {
  if (keyCount <= 1) return;

  if (status >= 200 && status < 400) {
    const providerCooldowns = apiKeyCooldowns.get(provider);
    providerCooldowns?.delete(keyIndex);
    if (providerCooldowns?.size === 0) apiKeyCooldowns.delete(provider);
    return;
  }

  if (!shouldCoolDown(status)) return;
  const cooldownSeconds = Config.apiKeyCooldownSeconds();
  if (cooldownSeconds === 0) return;

  let providerCooldowns = apiKeyCooldowns.get(provider);
  if (!providerCooldowns) {
    providerCooldowns = new Map();
    apiKeyCooldowns.set(provider, providerCooldowns);
  }
  providerCooldowns.set(keyIndex, Date.now() + cooldownSeconds * 1000);
  RequestLogger.warn(
    "provider.key.cooldown",
    "Provider credential entered cooldown",
    {
      provider,
      key_index: keyIndex,
      key_count: keyCount,
      status,
      cooldown_seconds: cooldownSeconds,
    },
  );
}

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
  credentialProfile?: string;
  providerRequestId?: string;
  step?: number;
}

export function determineApiKeySelectionPolicy(
  selection: ApiKeySelection | undefined,
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
  credentialProfile,
  providerRequestId = crypto.randomUUID(),
  step,
}: ApiKeySelectionLogOptions): LogFields {
  const hasKey = keyCount > 0;
  const fields: LogFields = {
    provider_request_id: providerRequestId,
    provider,
    ...(credentialProfile && credentialProfile !== "default"
      ? { credential_profile: credentialProfile }
      : {}),
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
  selection: ApiKeySelection | undefined,
  fallback: ApiKeyFallback,
  providerName?: string,
): Promise<number> {
  const keyCount = provider.getApiKeys().length;
  if (selection !== undefined) {
    return Secrets.resolveApiKeyIndex(selection, keyCount);
  }
  if (fallback !== "rotate" || keyCount <= 1) return 0;

  const selectedIndex = await provider.getNextApiKeyIndex();
  if (!providerName) return selectedIndex;
  const eligibleIndexes = getEligibleApiKeyIndexes(providerName, keyCount);
  if (!eligibleIndexes) return selectedIndex;

  // Eligibility is a non-empty ascending list. Find the first healthy slot at
  // or after the selected rotation phase, wrapping to the first when needed.
  // This avoids building a Set and scanning cooled slots a second time.
  for (const eligibleIndex of eligibleIndexes) {
    if (eligibleIndex >= selectedIndex) return eligibleIndex;
  }
  return eligibleIndexes[0];
}
