import { Environments } from "./environments";

export class Config {
  static isDevelopment(): boolean {
    const dev = Environments.get("DEV", false);
    return dev !== undefined && dev !== "False" && dev !== "false";
  }

  static apiKeys(): string[] | undefined {
    const apiKeys = Environments.get("PROXY_API_KEY");

    if (apiKeys === undefined) {
      return undefined;
    }

    if (Array.isArray(apiKeys)) {
      return apiKeys;
    }
    if (typeof apiKeys === "string") {
      return [apiKeys];
    }

    return undefined;
  }

  static aiGateway(): {
    accountId: string | undefined;
    name: string | undefined;
    token: string | undefined;
  } {
    return {
      accountId: Environments.get("CLOUDFLARE_ACCOUNT_ID", false),
      name: Environments.get("AI_GATEWAY_NAME", false),
      token: Environments.get("CF_AIG_TOKEN", false),
    };
  }

  static defaultModel(): string | undefined {
    const defaultModel = Environments.get("DEFAULT_MODEL", false);

    return defaultModel;
  }

  static isGlobalRoundRobinEnabled(): boolean {
    const enabled = Environments.get("ENABLE_GLOBAL_ROUND_ROBIN", false);
    return enabled === "true";
  }

  static customOpenAIEndpoints():
    | {
        name: string;
        baseUrl: string;
        apiKeys?: string | string[];
        models?: string[];
      }[]
    | undefined {
    const endpoints = Environments.get("CUSTOM_OPENAI_ENDPOINTS", false);

    if (endpoints === undefined || endpoints === null) {
      return undefined;
    }

    if (typeof endpoints === "string") {
      try {
        return JSON.parse(endpoints);
      } catch {
        return undefined;
      }
    }

    if (Array.isArray(endpoints)) {
      return endpoints;
    }

    return undefined;
  }
}
