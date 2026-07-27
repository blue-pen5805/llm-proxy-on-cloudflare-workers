const MAX_AI_GATEWAY_METADATA_ENTRIES = 5;

type ProxyGatewayMetadata = {
  provider?: string;
  model?: string;
  endpoint?: string;
  virtualModel?: string;
  credentials?: {
    credentialProfile: string;
    providerKeyIndex: number | null;
  };
};

/**
 * Add bounded proxy routing tags to AI Gateway custom metadata.
 *
 * Client entries win on key collisions. Invalid client JSON is preserved
 * unchanged so the proxy does not reinterpret or replace caller input.
 */
export function addProxyAiGatewayMetadata(
  headers: Headers,
  {
    provider,
    model,
    endpoint,
    virtualModel,
    credentials,
  }: ProxyGatewayMetadata,
): void {
  const rawMetadata = headers.get("cf-aig-metadata");
  let metadata: Record<string, unknown> = {};
  if (rawMetadata !== null) {
    try {
      const parsed = JSON.parse(rawMetadata) as unknown;
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        return;
      }
      metadata = parsed as Record<string, unknown>;
    } catch {
      return;
    }
  }

  const proxyEntries: [string, string | number | undefined][] = [
    ["llm_proxy_virtual_model", virtualModel],
    ["llm_proxy_endpoint", endpoint],
    ["llm_proxy_provider", provider],
    ["llm_proxy_model", model],
    [
      "llm_proxy_credentials",
      credentials === undefined
        ? undefined
        : `${credentials.credentialProfile}:${String(credentials.providerKeyIndex)}`,
    ],
  ];
  let entryCount = Object.keys(metadata).length;
  for (const [key, value] of proxyEntries) {
    if (
      value === undefined ||
      Object.prototype.hasOwnProperty.call(metadata, key) ||
      entryCount >= MAX_AI_GATEWAY_METADATA_ENTRIES
    ) {
      continue;
    }
    metadata[key] = value;
    entryCount++;
  }
  if (entryCount > 0) {
    headers.set("cf-aig-metadata", JSON.stringify(metadata));
  }
}
