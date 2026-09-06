import { Secrets } from "../../utils/secrets";
import { chatCompletionsEndpoint, jsonEndpoint } from "../inference";
import { defineProvider, Provider, ProviderConstructor } from "../provider";

const AZURE_RESOURCE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$/;
const DEFAULT_API_VERSION = "2024-10-21";

export type AzureOpenAI = Provider & {
  readonly resourceName: keyof Env;
  readonly apiVersionName: keyof Env;
};

function getAzureResourceName(provider: AzureOpenAI): string {
  const resourceName = Secrets.get(provider.resourceName);
  if (!AZURE_RESOURCE_PATTERN.test(resourceName)) {
    throw new Error("AZURE_OPENAI_RESOURCE_NAME is missing or invalid.");
  }
  return resourceName;
}

function getAzureApiVersion(provider: AzureOpenAI): string {
  return Secrets.get(provider.apiVersionName) || DEFAULT_API_VERSION;
}

export const AzureOpenAI = defineProvider({
  endpoints: {
    responses: jsonEndpoint("/responses", { supportsAiGateway: false }),
    chat_completions: chatCompletionsEndpoint(undefined, {
      prepareGateway(data) {
        const { model, ...body } = data;
        return {
          path: `/${encodeURIComponent(getAzureResourceName(this as AzureOpenAI))}/${encodeURIComponent(model)}/chat/completions?api-version=${encodeURIComponent(getAzureApiVersion(this as AzureOpenAI))}`,
          data: body,
        };
      },
    }),

    models: {
      requiresProviderCredentials: true,
      supportsAiGateway: false,
      path: "/models",
    },
  },

  properties: {
    resourceName: "AZURE_OPENAI_RESOURCE_NAME" as keyof Env,
    apiVersionName: "AZURE_OPENAI_API_VERSION" as keyof Env,
  },
  openAICompatible: true,
  apiKeyName: "AZURE_OPENAI_API_KEY",
  pathnamePrefix: "/openai/v1",
  available() {
    return (
      this.getApiKeys().length > 0 &&
      AZURE_RESOURCE_PATTERN.test(
        Secrets.get((this as AzureOpenAI).resourceName),
      )
    );
  },
  baseUrl() {
    return `https://${getAzureResourceName(this as AzureOpenAI)}.openai.azure.com`;
  },
  async headers(apiKeyIndex?: number): Promise<HeadersInit> {
    const apiKey = Secrets.get(
      "AZURE_OPENAI_API_KEY",
      apiKeyIndex,
      this.credentialProfile,
    );
    return apiKey
      ? { "Content-Type": "application/json", "api-key": apiKey }
      : { "Content-Type": "application/json" };
  },

  aiGatewayPath(pathname: string): string {
    const deploymentPathMatch = pathname.match(
      /^\/openai\/deployments\/([^/]+)\/(.*)$/,
    );
    if (!deploymentPathMatch) return pathname;

    return `/${encodeURIComponent(getAzureResourceName(this as AzureOpenAI))}/${deploymentPathMatch[1]}/${deploymentPathMatch[2]}`;
  },
}) as ProviderConstructor<[], AzureOpenAI>;
