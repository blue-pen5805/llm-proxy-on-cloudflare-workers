import type { InferenceRequestArguments } from "~/src/providers/inference";
import type { Provider } from "~/src/providers/provider";

/** Exercise the same resolved operation used by public inference routes. */
export async function buildInferenceRequest(
  provider: Provider,
  args: Omit<InferenceRequestArguments, "data"> & {
    data: Record<string, unknown>;
  },
): Promise<[string, RequestInit]> {
  const resolved = provider.resolveInference(
    String(args.data.model),
    "chat_completions",
  );
  if (!resolved) throw new Error("Provider does not support Chat Completions.");
  return resolved.endpoint.buildRequest.call(
    provider,
    args as InferenceRequestArguments,
  );
}
