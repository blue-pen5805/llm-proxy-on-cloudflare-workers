export const VIRTUAL_MODEL_PROVIDER_NAME = "virtual";
const MAX_VIRTUAL_MODELS = 100;
const MAX_VIRTUAL_MODEL_CANDIDATES = 16;
const MAX_VIRTUAL_MODEL_CANDIDATE_RETRIES = 5;
const MAX_VIRTUAL_MODEL_CANDIDATE_TIMEOUT = 300_000;
export const MAX_VIRTUAL_MODEL_EXPANDED_ATTEMPTS =
  MAX_VIRTUAL_MODEL_CANDIDATES * (MAX_VIRTUAL_MODEL_CANDIDATE_RETRIES + 1);

const VIRTUAL_MODEL_NAME_PATTERN = /^[A-Za-z0-9._~/-]{1,128}$/;

export interface VirtualModelCandidate {
  model: string;
  retries: number;
  /** Maximum time in milliseconds to wait for response headers. */
  timeout?: number;
}

export type VirtualModels = Readonly<
  Record<string, readonly VirtualModelCandidate[]>
>;

function isValidCandidateModel(model: unknown): model is string {
  if (typeof model !== "string") return false;
  const separatorIndex = model.indexOf("/");
  return separatorIndex > 0 && separatorIndex < model.length - 1;
}

function parseVirtualModelCandidate(
  value: unknown,
): VirtualModelCandidate | undefined {
  if (typeof value === "string") {
    return isValidCandidateModel(value)
      ? { model: value, retries: 0 }
      : undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  const allowedProperties = new Set(["model", "retries", "timeout"]);
  if (
    Object.keys(candidate).some((key) => !allowedProperties.has(key)) ||
    !isValidCandidateModel(candidate.model)
  ) {
    return undefined;
  }
  const retries = candidate.retries ?? 0;
  if (
    typeof retries !== "number" ||
    !Number.isInteger(retries) ||
    retries < 0 ||
    retries > MAX_VIRTUAL_MODEL_CANDIDATE_RETRIES
  ) {
    return undefined;
  }
  const timeout = candidate.timeout;
  if (
    timeout !== undefined &&
    (typeof timeout !== "number" ||
      !Number.isInteger(timeout) ||
      timeout < 1 ||
      timeout > MAX_VIRTUAL_MODEL_CANDIDATE_TIMEOUT)
  ) {
    return undefined;
  }
  return {
    model: candidate.model,
    retries,
    ...(timeout === undefined ? {} : { timeout }),
  };
}

function providerSelector(model: string): string {
  return model.slice(0, model.indexOf("/")).split(":", 1)[0];
}

/**
 * Returns true when the virtual-model graph contains a reachable cycle.
 * Provider selectors take precedence over virtual-model keys, so shadowed
 * keys are deliberately excluded from graph edges.
 */
export function hasVirtualModelCycle(
  virtualModels: VirtualModels,
  realProviderNames: ReadonlySet<string>,
): boolean {
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const visit = (name: string): boolean => {
    if (visiting.has(name)) return true;
    if (visited.has(name)) return false;
    visiting.add(name);
    // `name` originates from this map or from a candidate whose entry was
    // checked immediately before recursion, so it is structurally present.
    for (const candidate of virtualModels[name]!) {
      if (
        !realProviderNames.has(providerSelector(candidate.model)) &&
        virtualModels[candidate.model] !== undefined &&
        visit(candidate.model)
      ) {
        return true;
      }
    }
    visiting.delete(name);
    visited.add(name);
    return false;
  };

  return Object.keys(virtualModels).some(visit);
}

/**
 * Checks the worst-case number of concrete provider attempts after following
 * virtual references and applying retries. Call this only for an acyclic map.
 */
export function exceedsVirtualModelAttemptLimit(
  virtualModels: VirtualModels,
  realProviderNames: ReadonlySet<string>,
): boolean {
  const costs = new Map<string, number>();
  const cost = (name: string): number => {
    const cached = costs.get(name);
    if (cached !== undefined) return cached;
    let total = 0;
    // As above, cost is invoked only for keys proven to exist in this map.
    for (const candidate of virtualModels[name]!) {
      const nested =
        !realProviderNames.has(providerSelector(candidate.model)) &&
        virtualModels[candidate.model] !== undefined
          ? cost(candidate.model)
          : 1;
      total += (candidate.retries + 1) * nested;
      if (total > MAX_VIRTUAL_MODEL_EXPANDED_ATTEMPTS) return total;
    }
    costs.set(name, total);
    return total;
  };

  return Object.keys(virtualModels).some(
    (name) => cost(name) > MAX_VIRTUAL_MODEL_EXPANDED_ATTEMPTS,
  );
}

/** Validate and normalize the complete virtual-model map. */
export function parseVirtualModels(value: unknown): VirtualModels | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const rawMap = value as Record<string, unknown>;
  const virtualModelNames = Object.keys(rawMap);
  if (virtualModelNames.length > MAX_VIRTUAL_MODELS) return undefined;

  const normalized: Record<string, VirtualModelCandidate[]> = {};
  for (const virtualModelName of virtualModelNames) {
    if (!VIRTUAL_MODEL_NAME_PATTERN.test(virtualModelName)) return undefined;
    const rawCandidates = rawMap[virtualModelName];
    if (
      !Array.isArray(rawCandidates) ||
      rawCandidates.length === 0 ||
      rawCandidates.length > MAX_VIRTUAL_MODEL_CANDIDATES
    ) {
      return undefined;
    }
    const candidates: VirtualModelCandidate[] = [];
    for (const rawCandidate of rawCandidates) {
      const candidate = parseVirtualModelCandidate(rawCandidate);
      if (!candidate) return undefined;
      candidates.push(candidate);
    }
    normalized[virtualModelName] = candidates;
  }
  return normalized;
}
