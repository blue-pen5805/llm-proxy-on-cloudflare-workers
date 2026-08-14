import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  customProviderBaseUrl,
  customProviderSlug,
} from "../src/ai_gateway/custom_provider.ts";
import { CloudflareAIGateway } from "../src/ai_gateway/index.ts";
import { createProviderRegistry } from "../src/providers.ts";
import { parseProviderSelector } from "../src/providers/profile.ts";
import type { Provider } from "../src/providers/provider.ts";
import { Environments } from "../src/utils/environments.ts";
import { DEFAULT_PROVIDER_PROFILE } from "../src/utils/secrets.ts";

const CLOUDFLARE_API_ORIGIN = "https://api.cloudflare.com/client/v4";
const CUSTOM_PROVIDER_LOGOS: Readonly<Record<string, string>> = {
  cline: readFileSync(
    fileURLToPath(
      new URL("../src/providers/cline/logo.svg", import.meta.url).href,
    ),
    "base64",
  ),
  "nvidia-nim": readFileSync(
    fileURLToPath(
      new URL("../src/providers/nvidia-nim/logo.svg", import.meta.url).href,
    ),
    "base64",
  ),
  ollama: readFileSync(
    fileURLToPath(
      new URL("../src/providers/ollama/logo.svg", import.meta.url).href,
    ),
    "base64",
  ),
};

export interface CustomProviderTarget {
  name: string;
  slug: string;
  baseUrl: string;
  logo?: string;
}

interface CloudflareCustomProvider {
  id: string;
  name: string;
  slug: string;
  enable?: boolean;
  base_url: string;
  logo?: string;
}

interface CloudflareApiEnvelope<T> {
  success: boolean;
  result: T;
  result_info?: {
    page?: number;
    per_page?: number;
    total_count?: number;
  };
}

export interface CustomProviderSyncResult {
  enabled: boolean;
  desired: number;
  created: number;
  updated: number;
  unchanged: number;
  dryRun: boolean;
}

function configuredString(
  config: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = config[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isAlwaysUseEnabled(config: Record<string, unknown>): boolean {
  const value = config.ALWAYS_USE_AI_GATEWAY;
  return (
    value === true ||
    (typeof value === "string" && value.trim().toLowerCase() === "true")
  );
}

function needsCustomProvider(
  providerName: string,
  provider: Provider,
): boolean {
  return (
    provider.requiresCustomAiGatewayProvider ||
    !CloudflareAIGateway.isSupportedProvider(providerName) ||
    (provider.modelsPath !== "" && provider.supportsAiGatewayModels === false)
  );
}

/** Build the non-secret account-level provider definitions required at runtime. */
export function buildCustomProviderTargets(
  config: Record<string, unknown>,
): CustomProviderTarget[] {
  if (!isAlwaysUseEnabled(config)) return [];

  const providers = Environments.runWithConfig(config, () =>
    createProviderRegistry(Environments.all()).all(),
  );
  const targets: CustomProviderTarget[] = [];

  for (const [providerSelector, provider] of Object.entries(providers)) {
    // Credential profiles only change which API key is presented per request;
    // the Custom Provider stores the Base URL, which every profile of a
    // provider shares. Runtime routing likewise resolves the Custom Provider
    // from the bare provider name, so profiled selectors would register
    // duplicate, unreachable definitions such as "LLM Proxy / ollama:paid".
    const parsedSelector = parseProviderSelector(providerSelector);
    /* istanbul ignore next -- registry entries always use valid selectors */
    if (!parsedSelector) continue;
    const { providerName, profile } = parsedSelector;
    if (profile !== DEFAULT_PROVIDER_PROFILE) continue;
    if (!needsCustomProvider(providerName, provider)) continue;

    // Some provider origins depend on optional deployment metadata. They are
    // synchronized once that metadata is configured; unavailable providers
    // remain omitted from aggregate operations in the meantime.
    let baseUrl: string;
    try {
      baseUrl = customProviderBaseUrl(provider);
    } catch {
      continue;
    }

    targets.push({
      name: `LLM Proxy / ${providerName}`,
      slug: customProviderSlug(providerName),
      baseUrl,
      ...(CUSTOM_PROVIDER_LOGOS[providerName]
        ? { logo: CUSTOM_PROVIDER_LOGOS[providerName] }
        : {}),
    });
  }

  const slugs = targets.map(({ slug }) => slug);
  /* istanbul ignore next -- route names are unique and non-simple names include a hash */
  if (new Set(slugs).size !== slugs.length) {
    throw new Error("AI Gateway Custom Provider slugs are not unique.");
  }
  return targets;
}

async function readCloudflareResponse<T>(
  response: Response,
  operation: string,
): Promise<CloudflareApiEnvelope<T>> {
  if (!response.ok) {
    throw new Error(
      `Cloudflare AI Gateway ${operation} failed with HTTP ${response.status}.`,
    );
  }
  const value: unknown = await response.json();
  if (
    typeof value !== "object" ||
    value === null ||
    (value as { success?: unknown }).success !== true ||
    !("result" in value)
  ) {
    throw new Error(
      `Cloudflare AI Gateway ${operation} returned invalid JSON.`,
    );
  }
  return value as CloudflareApiEnvelope<T>;
}

async function listCustomProviders(
  accountId: string,
  apiToken: string,
  fetchImplementation: typeof fetch,
): Promise<CloudflareCustomProvider[]> {
  const providers: CloudflareCustomProvider[] = [];
  for (let page = 1; ; page++) {
    const response = await fetchImplementation(
      `${CLOUDFLARE_API_ORIGIN}/accounts/${encodeURIComponent(accountId)}/ai-gateway/custom-providers?page=${page}&per_page=100`,
      { headers: { Authorization: `Bearer ${apiToken}` } },
    );
    const envelope = await readCloudflareResponse<CloudflareCustomProvider[]>(
      response,
      "Custom Provider list",
    );
    if (!Array.isArray(envelope.result)) {
      throw new Error(
        "Cloudflare AI Gateway Custom Provider list returned invalid JSON.",
      );
    }
    providers.push(...envelope.result);
    const totalCount = envelope.result_info?.total_count;
    if (
      envelope.result.length < 100 ||
      (typeof totalCount === "number" && providers.length >= totalCount)
    ) {
      return providers;
    }
  }
}

async function writeCustomProvider(
  accountId: string,
  apiToken: string,
  target: CustomProviderTarget,
  existing: CloudflareCustomProvider | undefined,
  fetchImplementation: typeof fetch,
): Promise<"created" | "updated"> {
  const collectionUrl = `${CLOUDFLARE_API_ORIGIN}/accounts/${encodeURIComponent(accountId)}/ai-gateway/custom-providers`;
  const response = await fetchImplementation(
    existing
      ? `${collectionUrl}/${encodeURIComponent(existing.id)}`
      : collectionUrl,
    {
      method: existing ? "PATCH" : "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: target.name,
        slug: target.slug,
        base_url: target.baseUrl,
        enable: true,
        description: "Managed by Cloudflare Workers LLM Proxy.",
        ...(target.logo ? { logo: target.logo } : {}),
      }),
    },
  );
  await readCloudflareResponse<CloudflareCustomProvider>(
    response,
    existing ? "Custom Provider update" : "Custom Provider create",
  );
  return existing ? "updated" : "created";
}

/** Reconcile managed providers without deleting unrelated or stale entries. */
export async function syncAiGatewayCustomProviders(
  config: Record<string, unknown>,
  dryRun: boolean = false,
  fetchImplementation: typeof fetch = fetch,
): Promise<CustomProviderSyncResult> {
  if (!isAlwaysUseEnabled(config)) {
    return {
      enabled: false,
      desired: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      dryRun,
    };
  }

  const accountId = configuredString(config, "CLOUDFLARE_ACCOUNT_ID");
  const apiToken = configuredString(config, "CLOUDFLARE_API_TOKEN");
  if (!accountId) {
    throw new Error("ALWAYS_USE_AI_GATEWAY requires CLOUDFLARE_ACCOUNT_ID.");
  }
  if (!apiToken) {
    throw new Error(
      "ALWAYS_USE_AI_GATEWAY requires CLOUDFLARE_API_TOKEN with AI Gateway Write permission.",
    );
  }

  const targets = buildCustomProviderTargets(config);
  if (dryRun) {
    return {
      enabled: true,
      desired: targets.length,
      created: 0,
      updated: 0,
      unchanged: 0,
      dryRun: true,
    };
  }

  const existingProviders = await listCustomProviders(
    accountId,
    apiToken,
    fetchImplementation,
  );
  const existingBySlug = new Map<string, CloudflareCustomProvider>();
  for (const provider of existingProviders) {
    if (existingBySlug.has(provider.slug)) {
      throw new Error(
        "Cloudflare returned duplicate AI Gateway Custom Provider slugs.",
      );
    }
    existingBySlug.set(provider.slug, provider);
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  for (const target of targets) {
    const existing = existingBySlug.get(target.slug);
    if (existing && existing.name !== target.name) {
      throw new Error(
        `AI Gateway Custom Provider slug ${target.slug} is already owned by another definition.`,
      );
    }
    if (
      existing?.name === target.name &&
      new URL(existing.base_url).href === target.baseUrl &&
      existing.enable === true &&
      (target.logo === undefined || existing.logo === target.logo)
    ) {
      unchanged++;
      continue;
    }
    const operation = await writeCustomProvider(
      accountId,
      apiToken,
      target,
      existing,
      fetchImplementation,
    );
    if (operation === "created") created++;
    else updated++;
  }

  return {
    enabled: true,
    desired: targets.length,
    created,
    updated,
    unchanged,
    dryRun: false,
  };
}
