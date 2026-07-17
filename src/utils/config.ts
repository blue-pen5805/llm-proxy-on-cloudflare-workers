import { Environments } from "./environments";

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

interface CustomOpenAIEndpoint {
  name: string;
  baseUrl: string;
  apiKeys?: string | string[];
  models?: string[];
  chatCompletionPath?: string;
  modelsPath?: string;
}

function isOptionalStringArray(value: unknown): value is string[] | undefined {
  return value === undefined || isStringArray(value);
}

function isSafeCustomEndpoint(value: unknown): value is CustomOpenAIEndpoint {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const endpoint = value as Record<string, unknown>;
  if (
    typeof endpoint.name !== "string" ||
    !/^[A-Za-z0-9._~-]{1,128}$/.test(endpoint.name) ||
    typeof endpoint.baseUrl !== "string"
  ) {
    return false;
  }

  try {
    const baseUrl = new URL(endpoint.baseUrl);
    if (
      baseUrl.protocol !== "https:" ||
      baseUrl.username ||
      baseUrl.password ||
      baseUrl.search ||
      baseUrl.hash
    ) {
      return false;
    }
  } catch {
    return false;
  }

  const validOptionalPath = (path: unknown): boolean =>
    path === undefined ||
    (typeof path === "string" &&
      path.startsWith("/") &&
      !path.startsWith("//"));
  return (
    (endpoint.apiKeys === undefined ||
      typeof endpoint.apiKeys === "string" ||
      isStringArray(endpoint.apiKeys)) &&
    isOptionalStringArray(endpoint.models) &&
    validOptionalPath(endpoint.chatCompletionPath) &&
    validOptionalPath(endpoint.modelsPath)
  );
}

export class Config {
  static isDevelopment(): boolean {
    const dev = Environments.get("DEV", false);
    return dev?.trim().toLowerCase() === "true";
  }

  static apiKeys(): string[] | undefined {
    const apiKeys = Environments.get("PROXY_API_KEY");

    if (apiKeys === undefined) {
      return undefined;
    }

    if (isStringArray(apiKeys)) {
      return apiKeys.map((key) => key.trim()).filter(Boolean);
    }
    if (typeof apiKeys === "string") {
      const normalizedKey = apiKeys.trim();
      return normalizedKey ? [normalizedKey] : [];
    }

    return undefined;
  }

  static aiGateway(): {
    accountId: string | undefined;
    name: string | undefined;
    token: string | undefined;
    restApiToken: string | undefined;
  } {
    return {
      accountId: Environments.get("CLOUDFLARE_ACCOUNT_ID", false),
      name: Environments.get("AI_GATEWAY_NAME", false),
      token: Environments.get("CF_AIG_TOKEN", false),
      restApiToken: Environments.get("CLOUDFLARE_API_TOKEN", false),
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

    let parsedEndpoints: unknown = endpoints;
    if (typeof endpoints === "string") {
      try {
        parsedEndpoints = JSON.parse(endpoints) as unknown;
      } catch {
        return undefined;
      }
    }

    if (
      Array.isArray(parsedEndpoints) &&
      parsedEndpoints.every(isSafeCustomEndpoint)
    ) {
      return parsedEndpoints;
    }

    return undefined;
  }
}
