import type { OpenAIModelsListResponseBody } from "./openai/types";
import type { Provider } from "./provider";

export interface ModelsEndpoint {
  readonly path: string;
  readonly supportsAiGateway?: boolean;
  readonly requiresProviderCredentials?: boolean;
  /** Validate provider-specific discovery prerequisites before any network I/O. */
  validate?(this: Provider): void;
  convertResponse?(this: Provider, data: unknown): OpenAIModelsListResponseBody;
  getStaticModels?(this: Provider): OpenAIModelsListResponseBody | undefined;
}

/** Prepare a model probe once; both discovery and diagnostics use this contract. */
export async function buildModelsRequest(
  provider: Provider,
  endpoint: ModelsEndpoint,
  apiKeyIndex?: number,
  headers?: HeadersInit,
): Promise<[string, RequestInit]> {
  endpoint.validate?.call(provider);
  return [
    endpoint.path,
    {
      method: "GET",
      headers: await provider.buildHeadersForPath(
        endpoint.path,
        headers,
        apiKeyIndex,
      ),
    },
  ];
}

interface ModelWithMetadata {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

export function convertModelsToOpenAIFormatWithMetadata<
  T extends ModelWithMetadata,
>(providerResponse: { data: T[] }): OpenAIModelsListResponseBody {
  return {
    object: "list",
    data: providerResponse.data.map(
      ({ id, object, created, owned_by, ...providerMetadata }) => ({
        id,
        object,
        created,
        owned_by,
        _: providerMetadata,
      }),
    ),
  };
}
