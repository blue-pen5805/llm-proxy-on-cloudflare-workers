import { CloudflareAIGateway } from "../ai_gateway";
import { getAllProviders } from "../providers";
import { CustomOpenAI } from "../providers/custom-openai";
import { ProviderBase, ProviderNotSupportedError } from "../providers/provider";
import { Config } from "../utils/config";
import { Environments } from "../utils/environments";
import { fetch2 } from "../utils/helpers";
import { Secrets } from "../utils/secrets";

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
  aiGateway?: CloudflareAIGateway,
): Promise<"valid" | "invalid" | "unknown"> {
  if (!instance.modelsPath) {
    return "unknown";
  }

  try {
    if (aiGateway && CloudflareAIGateway.isSupportedProvider(providerName)) {
      const [requestInfo, requestInit] = aiGateway.buildProviderEndpointRequest(
        {
          provider: providerName as any,
          method: "GET",
          path: instance.modelsPath,
          headers: await instance.headers(apiKeyIndex),
        },
      );

      const response = await fetch2(requestInfo, requestInit);

      if (response.ok) {
        return "valid";
      } else if (response.status === 401 || response.status === 403) {
        return "invalid";
      } else {
        return "unknown";
      }
    }

    const [requestInfo, requestInit] =
      await instance.buildModelsRequest(apiKeyIndex);

    const response = await instance.fetch(
      requestInfo,
      requestInit,
      apiKeyIndex,
    );

    if (response.ok) {
      return "valid";
    } else if (response.status === 401 || response.status === 403) {
      return "invalid";
    } else {
      return "unknown";
    }
  } catch (error) {
    if (error instanceof ProviderNotSupportedError) {
      return "unknown";
    }
    console.error(`Error checking connectivity for ${providerName}:`, error);
    return "invalid";
  }
}

export async function status(aiGateway?: CloudflareAIGateway) {
  const config = {
    DEV: Config.isDevelopment(),
    DEFAULT_MODEL: Config.defaultModel() || null,
    AI_GATEWAY: Config.aiGateway(),
    GLOBAL_ROUND_ROBIN: Config.isGlobalRoundRobinEnabled(),
  };

  const providersStatus: Record<string, any> = {};
  const env = Environments.all();
  const allProviders = getAllProviders(env);

  for (const [providerName, instance] of Object.entries(allProviders)) {
    let allKeys: string[] = [];

    if (instance instanceof CustomOpenAI) {
      allKeys = instance.getApiKeys();
    } else {
      const apiKeyName = instance.apiKeyName;
      if (apiKeyName) {
        allKeys = Secrets.getAll(apiKeyName);
      }
    }

    if (allKeys.length === 0) {
      providersStatus[providerName] = {
        available: instance.available(),
        keys: [],
      };
      continue;
    }
    const keyStatuses = await Promise.all(
      allKeys.map(async (_key, apiKeyIndex) => ({
        key: maskApiKey(_key),
        status: await checkConnectivity(
          instance,
          providerName,
          apiKeyIndex,
          aiGateway,
        ),
      })),
    );

    providersStatus[providerName] = {
      available: instance.available(),
      keys: keyStatuses,
    };
  }

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
