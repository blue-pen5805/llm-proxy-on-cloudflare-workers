import { CloudflareAIGateway } from "../ai_gateway";
import { getAllProviderInstances } from "../providers";
import type { ProviderRegistry } from "../providers";
import { ProviderBase, ProviderNotSupportedError } from "../providers/provider";
import { recordApiKeySelection } from "../utils/api_key_selection";
import { Config } from "../utils/config";
import { Environments } from "../utils/environments";
import { fetchWithLogging, withTimeout } from "../utils/helpers";
import { RequestLogger } from "../utils/logger";

const CONNECTIVITY_CHECK_TIMEOUT_MS = 5000;

type ConnectivityStatus = "valid" | "invalid" | "unknown";

interface ProviderStatus {
  available: boolean;
  keys: { key: string; status: ConnectivityStatus }[];
}

/**
 * Masks an API key, showing only the last 3 characters.
 * @param key The API key to mask.
 * @returns The masked API key.
 */
function maskApiKey(key: string): string {
  if (key.length <= 3) {
    return "***";
  }
  return "*".repeat(Math.min(10, key.length - 3)) + key.slice(-3);
}

function classifyConnectivity(response: Response): ConnectivityStatus {
  if (response.ok) return "valid";
  if (response.status === 401 || response.status === 403) return "invalid";
  return "unknown";
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
  providerName: string,
  apiKeyIndex: number,
  keyCount: number,
  aiGateway?: CloudflareAIGateway,
): Promise<ConnectivityStatus> {
  if (!providerInstance.modelsPath) {
    return "unknown";
  }

  const abortController = new AbortController();
  const aiGatewayProvider =
    aiGateway && CloudflareAIGateway.isSupportedProvider(providerName)
      ? providerName
      : undefined;
  const keyLogFields = recordApiKeySelection({
    provider: providerName,
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
          path: providerInstance.modelsPath,
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

    return classifyConnectivity(connectivityResponse);
  } catch (error) {
    if (
      error instanceof ProviderNotSupportedError ||
      (error instanceof Error && error.name === "TimeoutError")
    ) {
      return "unknown";
    }
    RequestLogger.error("provider.connectivity.failed", error, {
      provider: providerName,
    });
    return "invalid";
  }
}

export async function handleStatusRequest(
  aiGateway?: CloudflareAIGateway,
  providerRegistry?: ProviderRegistry,
) {
  const aiGatewayConfig = Config.aiGateway();
  const configurationStatus = {
    DEV: Config.isDevelopment(),
    DEFAULT_MODEL: Config.defaultModel() || null,
    AI_GATEWAY: {
      ...aiGatewayConfig,
      token: aiGatewayConfig.token ? "***" : undefined,
      restApiToken: aiGatewayConfig.restApiToken ? "***" : undefined,
    },
    GLOBAL_ROUND_ROBIN: Config.isGlobalRoundRobinEnabled(),
  };

  const env = Environments.all();
  const providerEntries = Object.entries(
    providerRegistry?.all() ?? getAllProviderInstances(env),
  );
  const providersStatus = Object.fromEntries(
    await Promise.all(
      providerEntries.map(async ([providerName, providerInstance]) => {
        const allApiKeys = providerInstance.getApiKeys();
        const keyStatuses = await Promise.all(
          allApiKeys.map(async (apiKey, apiKeyIndex) => ({
            key: maskApiKey(apiKey),
            status: await checkProviderConnectivity(
              providerInstance,
              providerName,
              apiKeyIndex,
              allApiKeys.length,
              aiGateway,
            ),
          })),
        );

        return [
          providerName,
          {
            available: providerInstance.available(),
            keys: keyStatuses,
          } satisfies ProviderStatus,
        ] as const;
      }),
    ),
  );

  const responseBody = {
    config: configurationStatus,
    providers: providersStatus,
  };

  return new Response(JSON.stringify(responseBody, null, 2), {
    headers: {
      "Content-Type": "application/json",
    },
  });
}
