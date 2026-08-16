import type { MiddlewareContext } from "../middleware";
import type { ProviderBase } from "../providers/provider";
import { Secrets } from "./secrets";

type ApiKeyFallback = "first" | "rotate";
type ApiKeySelection = MiddlewareContext["apiKeyIndex"];

/** Resolve an explicit key selection or apply the endpoint's fallback policy. */
export async function selectApiKeyIndex(
  provider: ProviderBase,
  selection: ApiKeySelection,
  fallback: ApiKeyFallback,
): Promise<number> {
  const keyCount = provider.getApiKeys().length;
  if (keyCount <= 0) {
    return 0;
  }
  if (selection !== undefined) {
    return Secrets.resolveApiKeyIndex(selection, keyCount);
  }
  return fallback === "rotate" ? provider.getNextApiKeyIndex() : 0;
}

/**
 * Ordered API key indices to try, starting at `firstIndex` and wrapping
 * within the allowed set. A numeric selection may fail over to any key;
 * a range selection stays inside that range.
 */
export function listApiKeyIndicesToTry(
  selection: ApiKeySelection,
  keyCount: number,
  firstIndex: number,
): number[] {
  if (keyCount <= 1) {
    return [0];
  }

  const allowed = new Set(allowedApiKeyIndices(selection, keyCount));
  if (allowed.size === 0) {
    return [firstIndex];
  }

  const start = allowed.has(firstIndex) ? firstIndex : [...allowed][0];
  const indices: number[] = [];
  for (let offset = 0; offset < keyCount; offset++) {
    const index = (start + offset) % keyCount;
    if (allowed.has(index)) {
      indices.push(index);
    }
  }
  return indices;
}

function allowedApiKeyIndices(
  selection: ApiKeySelection,
  keyCount: number,
): number[] {
  if (selection === undefined || typeof selection === "number") {
    return Array.from({ length: keyCount }, (_, i) => i);
  }

  const start = (selection.start ?? 0) % keyCount;
  const end =
    selection.end === undefined
      ? keyCount - 1
      : Math.min(selection.end, keyCount - 1);

  if (start >= end) {
    return [start];
  }

  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}
