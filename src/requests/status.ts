import { CloudflareAIGateway } from "../ai_gateway";
import { getAllProviders } from "../providers";
import type { ProviderRegistry } from "../providers";
import { CustomOpenAI } from "../providers/custom-openai";
import { GoogleVertexAi } from "../providers/google-vertex-ai";
import { ProviderBase, ProviderNotSupportedError } from "../providers/provider";
import { recordApiKeySelection } from "../utils/api_key_selection";
import { Config } from "../utils/config";
import { Environments } from "../utils/environments";
import { fetch2, withTimeout } from "../utils/helpers";
import { RequestLogger } from "../utils/logger";
import { Secrets } from "../utils/secrets";

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

function getProviderKeys(instance: ProviderBase): string[] {
  if (instance instanceof CustomOpenAI || instance instanceof GoogleVertexAi) {
    return instance.getApiKeys();
  }
  return instance.apiKeyName ? Secrets.getAll(instance.apiKeyName) : [];
}

/**
 * Checks connectivity for a specific API key of a provider.
 * @param instance The provider instance.
 * @param providerName The name of the provider.
 * @param apiKeyIndex The index of the API key.
 * @param aiGateway The AI Gateway instance.
 * @returns Connectivity status.
 */
async function checkConnectivity(
  instance: ProviderBase,
  providerName: string,
  apiKeyIndex: number,
  keyCount: number,
  aiGateway?: CloudflareAIGateway,
): Promise<ConnectivityStatus> {
  if (!instance.modelsPath) {
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
          path: instance.modelsPath,
          headers: await instance.headers(apiKeyIndex),
        },
      );

      responsePromise = RequestLogger.withFields(keyLogFields, () =>
        fetch2(requestInfo, {
          ...requestInit,
          signal: abortController.signal,
        }),
      );
    } else {
      responsePromise = (async () => {
        const [requestInfo, requestInit] =
          await instance.buildModelsRequest(apiKeyIndex);
        return RequestLogger.withFields(keyLogFields, () =>
          instance.fetch(
            requestInfo,
            { ...requestInit, signal: abortController.signal },
            apiKeyIndex,
          ),
        );
      })();
    }

    const response = await withTimeout(
      responsePromise,
      abortController,
      CONNECTIVITY_CHECK_TIMEOUT_MS,
      providerName,
    );

    return classifyConnectivity(response);
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

export async function status(
  aiGateway?: CloudflareAIGateway,
  providerRegistry?: ProviderRegistry,
) {
  const aiGatewayConfig = Config.aiGateway();
  const config = {
    DEV: Config.isDevelopment(),
    DEFAULT_MODEL: Config.defaultModel() || null,
    AI_GATEWAY: {
      ...aiGatewayConfig,
      token: aiGatewayConfig.token ? "***" : undefined,
    },
    GLOBAL_ROUND_ROBIN: Config.isGlobalRoundRobinEnabled(),
  };

  const env = Environments.all();
  const providerEntries = Object.entries(
    providerRegistry?.all() ?? getAllProviders(env),
  );
  const providersStatus = Object.fromEntries(
    await Promise.all(
      providerEntries.map(async ([providerName, instance]) => {
        const allKeys = getProviderKeys(instance);
        const keyStatuses = await Promise.all(
          allKeys.map(async (key, apiKeyIndex) => ({
            key: maskApiKey(key),
            status: await checkConnectivity(
              instance,
              providerName,
              apiKeyIndex,
              allKeys.length,
              aiGateway,
            ),
          })),
        );

        return [
          providerName,
          {
            available: instance.available(),
            keys: keyStatuses,
          } satisfies ProviderStatus,
        ] as const;
      }),
    ),
  );

  const responseBody = {
    config,
    providers: providersStatus,
  };

  return new Response(JSON.stringify(responseBody, null, 2), {
    headers: {
      "Content-Type": "application/json",
    },
  });
}
