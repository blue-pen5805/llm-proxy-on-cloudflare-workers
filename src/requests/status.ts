import { Providers } from "../providers";
import { Config } from "../utils/config";
import { Environments } from "../utils/environments";
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
 * @param providerName The name of the provider.
 * @param apiKeyName The environment variable name for the API key.
 * @param apiKey The API key to check.
 * @returns Connectivity status.
 */
async function checkConnectivity(
  providerName: string,
  apiKeyName: keyof Env,
  apiKey: string,
): Promise<"valid" | "invalid" | "unknown"> {
  const providerClass = Providers[providerName];
  if (!providerClass) return "unknown";

  const originalEnv = Environments.getEnv();
  // Create a pseudo-environment where only this specific API key is returned
  const mockEnv = {
    ...originalEnv,
    [apiKeyName]: apiKey,
  } as Env;

  // Temporarily set the environment to the mock environment
  Environments.setEnv(mockEnv);

  try {
    const instance = new providerClass();
    const [requestInfo, requestInit] = await instance.buildModelsRequest();

    const response = await instance.fetch(requestInfo, requestInit);

    if (response.ok) {
      return "valid";
    } else if (response.status === 401 || response.status === 403) {
      return "invalid";
    } else {
      return "unknown";
    }
  } catch (error) {
    console.error(`Error checking connectivity for ${providerName}:`, error);
    return "invalid";
  } finally {
    // Restore the original environment
    Environments.setEnv(originalEnv!);
  }
}

export async function status() {
  const config = {
    DEV: Config.isDevelopment(),
    DEFAULT_MODEL: Config.defaultModel() || null,
    AI_GATEWAY: Config.aiGateway(),
    GLOBAL_ROUND_ROBIN: Config.isGlobalRoundRobinEnabled(),
  };

  const providersStatus: Record<string, any> = {};

  for (const providerName of Object.keys(Providers)) {
    const providerClass = Providers[providerName];
    const instance = new providerClass();
    const apiKeyName = instance.apiKeyName;

    if (!apiKeyName) {
      providersStatus[providerName] = {
        available: instance.available(),
        keys: [],
      };
      continue;
    }

    const allKeys = Secrets.getAll(apiKeyName);
    const keyStatuses = await Promise.all(
      allKeys.map(async (key) => ({
        key: maskApiKey(key),
        status: await checkConnectivity(providerName, apiKeyName, key),
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
