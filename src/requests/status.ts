import { CloudflareAIGateway } from "../ai_gateway";
import { gatewayProviderPath } from "../ai_gateway/custom_provider";
import { getAllProviderInstances } from "../providers";
import type { ProviderRegistry } from "../providers";
import { parseProviderSelector } from "../providers/profile";
import { ProviderBase, ProviderNotSupportedError } from "../providers/provider";
import type { RoutedRequestContext } from "../request_context";
import { recordApiKeySelection } from "../utils/api_key_selection";
import { Config } from "../utils/config";
import { Environments } from "../utils/environments";
import { fetchWithLogging, withTimeout } from "../utils/helpers";
import { RequestLogger } from "../utils/logger";
import { resolveAiGatewayModelsProvider } from "./model_gateway";
import { NO_STORE_HEADERS } from "./response";

const CONNECTIVITY_CHECK_TIMEOUT_MS = 5000;
const STATUS_CACHE_NAME = "llm-proxy-status";

type ConnectivityStatus = "valid" | "invalid" | "unknown";

interface ProviderStatus {
  available: boolean;
  keys: { slot: number; status: ConnectivityStatus }[];
}

function classifyConnectivity(response: Response): ConnectivityStatus {
  if (response.ok) return "valid";
  if (response.status === 401 || response.status === 403) return "invalid";
  return "unknown";
}

function isSubrequestLimitError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.toLowerCase().includes("too many subrequests")
  );
}

/**
 * Checks connectivity for a specific API key of a provider.
 * @param instance The provider instance.
 * @param providerName The name of the provider.
 * @param apiKeyIndex The index of the API key.
 * @param aiGateway The AI Gateway instance.
 * @returns Connectivity status.
 */
async function checkProviderConnectivity(
  providerInstance: ProviderBase,
  providerSelector: string,
  apiKeyIndex: number,
  keyCount: number,
  aiGateway?: CloudflareAIGateway,
): Promise<ConnectivityStatus> {
  const parsedSelector = parseProviderSelector(providerSelector);
  /* istanbul ignore next -- registry entries always use valid selectors */
  if (!parsedSelector) return "unknown";
  const { providerName, profile } = parsedSelector;
  /* istanbul ignore next -- callers exclude providers without a models route */
  if (!providerInstance.modelsPath) {
    return "unknown";
  }

  const abortController = new AbortController();
  const aiGatewayProvider = resolveAiGatewayModelsProvider(
    providerName,
    providerInstance,
    aiGateway,
  );
  const keyLogFields = recordApiKeySelection({
    provider: providerName,
    credentialProfile: profile,
    operation: "connectivity_check",
    keyIndex: apiKeyIndex,
    keyCount,
    selectionPolicy: "diagnostic_scan",
    viaAiGateway: aiGatewayProvider !== undefined,
  });

  try {
    let responsePromise: Promise<Response>;

    if (aiGateway && aiGatewayProvider) {
      const [requestInfo, requestInit] = aiGateway.buildProviderEndpointRequest(
        {
          provider: aiGatewayProvider,
          method: "GET",
          path: gatewayProviderPath(
            providerName,
            providerInstance,
            providerInstance.modelsPath,
            aiGatewayProvider,
          ),
          headers: await providerInstance.headers(apiKeyIndex),
        },
      );

      responsePromise = RequestLogger.withFields(keyLogFields, () =>
        fetchWithLogging(requestInfo, {
          ...requestInit,
          signal: abortController.signal,
        }),
      );
    } else {
      responsePromise = (async () => {
        const [requestInfo, requestInit] =
          await providerInstance.buildModelsRequest(apiKeyIndex);
        return RequestLogger.withFields(keyLogFields, () =>
          providerInstance.fetch(
            requestInfo,
            { ...requestInit, signal: abortController.signal },
            apiKeyIndex,
          ),
        );
      })();
    }

    const connectivityResponse = await withTimeout(
      responsePromise,
      abortController,
      CONNECTIVITY_CHECK_TIMEOUT_MS,
      providerName,
    );

    const connectivityStatus = classifyConnectivity(connectivityResponse);
    if (connectivityResponse.body) {
      await connectivityResponse.body.cancel().catch(() => undefined);
    }
    return connectivityStatus;
  } catch (error) {
    if (
      error instanceof ProviderNotSupportedError ||
      (error instanceof Error && error.name === "TimeoutError") ||
      isSubrequestLimitError(error)
    ) {
      return "unknown";
    }
    RequestLogger.error(
      "provider.connectivity.failed",
      "Provider connectivity check failed",
      error,
      {
        provider: providerName,
      },
    );
    return "invalid";
  }
}

export async function handleStatusRequest(
  aiGateway?: CloudflareAIGateway,
  providerRegistry?: ProviderRegistry,
  context?: RoutedRequestContext,
) {
  const cacheTtlSeconds = Config.statusCacheTtlSeconds();
  const requestCacheControl =
    context?.request.headers.get("Cache-Control")?.toLowerCase() ?? "";
  const cacheEnabled =
    context !== undefined &&
    cacheTtlSeconds > 0 &&
    !requestCacheControl.includes("no-store");
  let statusCache: { cache: Cache; key: Request } | undefined;
  if (cacheEnabled) {
    try {
      const cache = await caches.open(STATUS_CACHE_NAME);
      const gatewayScope = aiGateway
        ? `${aiGateway.accountId}/${aiGateway.gatewayId}/${aiGateway.alwaysUse ? "always" : "auto"}`
        : "direct";
      const key = new Request(
        `https://status-cache.llm-proxy.internal/${gatewayScope}`,
      );
      if (!requestCacheControl.includes("no-cache")) {
        const cached = await cache.match(key);
        if (cached) {
          const headers = new Headers(cached.headers);
          headers.set("Cache-Control", NO_STORE_HEADERS["Cache-Control"]);
          headers.set("X-Proxy-Status-Cache", "HIT");
          return new Response(cached.body, { headers });
        }
      }
      statusCache = { cache, key };
    } catch {
      RequestLogger.warn(
        "status.cache.unavailable",
        "Status cache operation was unavailable; continuing without it",
      );
    }
  }

  const aiGatewayConfig = Config.aiGateway();
  const configurationStatus = {
    DEV: Config.isDevelopment(),
    DEFAULT_MODEL: Config.defaultModel() || null,
    CHAT_RESPONSE_METADATA_ENABLED: Config.chatResponseMetadataEnabled(),
    AI_GATEWAY: {
      ...aiGatewayConfig,
      token: aiGatewayConfig.token ? "***" : undefined,
      restApiToken: aiGatewayConfig.restApiToken ? "***" : undefined,
    },
    API_KEY_COOLDOWN_SECONDS: Config.apiKeyCooldownSeconds(),
    STATUS_CACHE_TTL_SECONDS: cacheTtlSeconds,
  };

  const env = Environments.all();
  const providerEnumeration = providerRegistry?.allSettled();
  const providerEntries = Object.entries(
    providerEnumeration?.providers ?? getAllProviderInstances(env),
  );
  // A configured endpoint may be named "__proto__"; see ProviderRegistry.
  const providersStatus = Object.create(null) as Record<string, ProviderStatus>;
  const connectivityTasks: (() => Promise<void>)[] = [];

  for (const { providerName, error } of providerEnumeration?.failures ?? []) {
    RequestLogger.error(
      "provider.status.failed",
      "Provider status could not be determined",
      error,
      { provider: providerName },
    );
    providersStatus[providerName] = { available: false, keys: [] };
  }

  for (const [providerName, providerInstance] of providerEntries) {
    // A provider adapter that throws while reading its own configuration must
    // not remove the other providers from the diagnostic.
    let allApiKeys: string[];
    let providerStatus: ProviderStatus;
    try {
      allApiKeys = providerInstance.getApiKeys();
      providerStatus = {
        available: providerInstance.available(),
        keys: allApiKeys.map((_apiKey, apiKeyIndex) => ({
          slot: apiKeyIndex,
          status: "unknown",
        })),
      };
    } catch (error) {
      RequestLogger.error(
        "provider.status.failed",
        "Provider status could not be determined",
        error,
        { provider: providerName },
      );
      providersStatus[providerName] = { available: false, keys: [] };
      continue;
    }
    providersStatus[providerName] = providerStatus;

    for (let apiKeyIndex = 0; apiKeyIndex < allApiKeys.length; apiKeyIndex++) {
      if (!providerInstance.modelsPath) {
        continue;
      }
      connectivityTasks.push(async () => {
        providerStatus.keys[apiKeyIndex].status =
          await checkProviderConnectivity(
            providerInstance,
            providerName,
            apiKeyIndex,
            allApiKeys.length,
            aiGateway,
          );
      });
    }
  }

  // The number of checks follows the deployed credential count, so a large
  // configuration can exhaust the Worker's per-request subrequest budget.
  // Settle every check independently: an individual failure leaves that slot's
  // status behind and never turns the whole diagnostic into an error response.
  await Promise.allSettled(connectivityTasks.map((task) => task()));

  const responseBody = {
    config: configurationStatus,
    providers: providersStatus,
  };

  const responseText = JSON.stringify(responseBody);
  if (statusCache) {
    const put = statusCache.cache
      .put(
        statusCache.key,
        new Response(responseText, {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": `public, max-age=${cacheTtlSeconds}`,
          },
        }),
      )
      .catch(() => {
        RequestLogger.warn(
          "status.cache.unavailable",
          "Status cache operation was unavailable; continuing without it",
        );
      });
    context?.ctx.waitUntil(put);
  }

  return new Response(responseText, {
    headers: {
      "Content-Type": "application/json",
      ...NO_STORE_HEADERS,
      ...(statusCache ? { "X-Proxy-Status-Cache": "MISS" } : {}),
    },
  });
}
