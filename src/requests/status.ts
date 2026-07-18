import { CloudflareAIGateway } from "../ai_gateway";
import { gatewayProviderPath } from "../ai_gateway/custom_provider";
import { getAllProviderInstances } from "../providers";
import type { ProviderRegistry } from "../providers";
import { ProviderBase, ProviderNotSupportedError } from "../providers/provider";
import { recordApiKeySelection } from "../utils/api_key_selection";
import { Config } from "../utils/config";
import { Environments } from "../utils/environments";
import { fetchWithLogging, withTimeout } from "../utils/helpers";
import { RequestLogger } from "../utils/logger";
import { resolveAiGatewayModelsProvider } from "./model_gateway";

const CONNECTIVITY_CHECK_TIMEOUT_MS = 5000;
export const STATUS_CONNECTIVITY_CONCURRENCY = 5;

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
  const aiGatewayProvider = resolveAiGatewayModelsProvider(
    providerName,
    providerInstance,
    aiGateway,
  );
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
  const providersStatus: Record<string, ProviderStatus> = {};
  const connectivityTasks: (() => Promise<void>)[] = [];

  for (const [providerName, providerInstance] of providerEntries) {
    const allApiKeys = providerInstance.getApiKeys();
    const providerStatus: ProviderStatus = {
      available: providerInstance.available(),
      keys: allApiKeys.map((_apiKey, apiKeyIndex) => ({
        slot: apiKeyIndex,
        status: "unknown",
      })),
    };
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

  for (
    let taskIndex = 0;
    taskIndex < connectivityTasks.length;
    taskIndex += STATUS_CONNECTIVITY_CONCURRENCY
  ) {
    await Promise.all(
      connectivityTasks
        .slice(taskIndex, taskIndex + STATUS_CONNECTIVITY_CONCURRENCY)
        .map((task) => task()),
    );
  }

  const responseBody = {
    config: configurationStatus,
    providers: providersStatus,
  };

  return new Response(JSON.stringify(responseBody), {
    headers: {
      "Content-Type": "application/json",
    },
  });
}
