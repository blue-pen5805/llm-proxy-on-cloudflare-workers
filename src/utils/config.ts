import { BUILT_IN_PROVIDER_NAME_SET } from "../providers/names";
import { Environments } from "./environments";

export const MAX_CUSTOM_OPENAI_ENDPOINTS = 16;
export const MAX_PROXY_API_KEYS = 64;
const MAX_CUSTOM_ENDPOINT_KEYS = 32;
const MAX_CUSTOM_ENDPOINT_MODELS = 1000;

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
  const allowedProperties = new Set([
    "name",
    "baseUrl",
    "apiKeys",
    "models",
    "chatCompletionPath",
    "modelsPath",
  ]);
  if (
    Object.keys(endpoint).some((key) => !allowedProperties.has(key)) ||
    typeof endpoint.name !== "string" ||
    !/^[A-Za-z0-9._~-]{1,128}$/.test(endpoint.name) ||
    BUILT_IN_PROVIDER_NAME_SET.has(endpoint.name) ||
    typeof endpoint.baseUrl !== "string" ||
    endpoint.baseUrl.length > 2048
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
      path.length <= 2048 &&
      path.startsWith("/") &&
      !path.startsWith("//"));
  const validApiKeys =
    endpoint.apiKeys === undefined ||
    (typeof endpoint.apiKeys === "string" && endpoint.apiKeys.trim() !== "") ||
    (isStringArray(endpoint.apiKeys) &&
      endpoint.apiKeys.length <= MAX_CUSTOM_ENDPOINT_KEYS &&
      endpoint.apiKeys.every((key) => key.trim() !== ""));
  const validModels =
    isOptionalStringArray(endpoint.models) &&
    (endpoint.models === undefined ||
      (endpoint.models.length <= MAX_CUSTOM_ENDPOINT_MODELS &&
        endpoint.models.every((model) => model.trim() !== "")));
  return (
    validApiKeys &&
    validModels &&
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
      if (apiKeys.length > MAX_PROXY_API_KEYS) return undefined;
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
      !Array.isArray(parsedEndpoints) ||
      parsedEndpoints.length > MAX_CUSTOM_OPENAI_ENDPOINTS ||
      !parsedEndpoints.every(isSafeCustomEndpoint)
    ) {
      return undefined;
    }

    const validatedEndpoints = parsedEndpoints as CustomOpenAIEndpoint[];
    const endpointNames = validatedEndpoints.map((endpoint) => endpoint.name);
    if (new Set(endpointNames).size !== endpointNames.length) return undefined;
    return validatedEndpoints;
  }
}
