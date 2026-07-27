import type { MiddlewareContext } from "../middleware";
import { Config, VIRTUAL_MODEL_PROVIDER_NAME } from "../utils/config";
import type { VirtualModelCandidate, VirtualModels } from "../utils/config";
import { ConfigurationError } from "../utils/error";
import { resolveProvider } from "./provider_request";
import { NO_STORE_HEADERS } from "./response";

interface VirtualModelAccessOrderEntry {
  position: number;
  model: string;
  retries: number;
  attempts: number;
  timeout_ms?: number;
  access_order?: VirtualModelAccessOrderEntry[];
}

/**
 * Recursively expands virtual-model references while preserving each retry
 * boundary. Config validation guarantees that the reference graph is acyclic.
 */
function expandAccessOrder(
  context: MiddlewareContext,
  virtualModels: VirtualModels,
  candidates: readonly VirtualModelCandidate[],
  resolving: ReadonlySet<string>,
): VirtualModelAccessOrderEntry[] {
  return candidates.map((candidate, index) => {
    const [providerSelector] = candidate.model.split("/");
    const referencedCandidates = resolveProvider(context, providerSelector)
      ? undefined
      : virtualModels[candidate.model];
    if (referencedCandidates !== undefined && resolving.has(candidate.model)) {
      throw new ConfigurationError("VIRTUAL_MODELS");
    }

    return {
      position: index + 1,
      model: candidate.model,
      retries: candidate.retries,
      attempts: candidate.retries + 1,
      ...(candidate.timeout === undefined
        ? {}
        : { timeout_ms: candidate.timeout }),
      ...(referencedCandidates === undefined
        ? {}
        : {
            access_order: expandAccessOrder(
              context,
              virtualModels,
              referencedCandidates,
              new Set(resolving).add(candidate.model),
            ),
          }),
    };
  });
}

/** Lists operator-defined virtual models and their expanded access order. */
export function handleVirtualModelsRequest(
  context: MiddlewareContext,
): Response {
  const virtualModels = Config.virtualModels() ?? {};

  return Response.json(
    {
      object: "list",
      data: Object.entries(virtualModels).map(([id, candidates]) => ({
        id,
        object: "model",
        created: 0,
        owned_by: VIRTUAL_MODEL_PROVIDER_NAME,
        access_order: expandAccessOrder(
          context,
          virtualModels,
          candidates,
          new Set([id]),
        ),
      })),
    },
    { headers: NO_STORE_HEADERS },
  );
}
