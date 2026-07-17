import { Secrets } from "../../utils/secrets";
import { OpenAICompatibleProvider } from "../provider";

const AZURE_RESOURCE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$/;
const DEFAULT_API_VERSION = "2024-10-21";

export class AzureOpenAI extends OpenAICompatibleProvider {
  readonly apiKeyName: keyof Env = "AZURE_OPENAI_API_KEY";
  readonly resourceName: keyof Env = "AZURE_OPENAI_RESOURCE_NAME";
  readonly apiVersionName: keyof Env = "AZURE_OPENAI_API_VERSION";
  readonly pathnamePrefixProp = "/openai/v1";
  readonly supportsAiGatewayModels = false;
  readonly supportsAiGatewayNativeChat = true;

  baseUrl(): string {
    const resource = this.resource();
    return `https://${resource}.openai.azure.com`;
  }

  async headers(apiKeyIndex?: number): Promise<HeadersInit> {
    const apiKey = Secrets.get(this.apiKeyName, apiKeyIndex);
    return apiKey
      ? { "Content-Type": "application/json", "api-key": apiKey }
      : { "Content-Type": "application/json" };
  }

  aiGatewayPath(pathname: string): string {
    const match = pathname.match(/^\/openai\/deployments\/([^/]+)\/(.*)$/);
    if (!match) return pathname;

    return `/${encodeURIComponent(this.resource())}/${match[1]}/${match[2]}`;
  }

  async buildAiGatewayChatCompletionsRequest({
    data,
    headers,
    apiKeyIndex,
  }: {
    data: Readonly<Record<string, unknown>> & { model: string };
    headers: HeadersInit;
    apiKeyIndex?: number;
  }): Promise<[string, RequestInit]> {
    const { model, ...body } = data;
    const gatewayHeaders = new Headers(headers);
    const providerHeaders = new Headers(await this.headers(apiKeyIndex));
    providerHeaders.forEach((value, key) => gatewayHeaders.set(key, value));

    return [
      `/${encodeURIComponent(this.resource())}/${encodeURIComponent(model)}/chat/completions?api-version=${encodeURIComponent(this.apiVersion())}`,
      {
        method: "POST",
        body: JSON.stringify(body),
        headers: Object.fromEntries(gatewayHeaders.entries()),
      },
    ];
  }

  private resource(): string {
    const resource = Secrets.get(this.resourceName);
    if (!AZURE_RESOURCE_PATTERN.test(resource)) {
      throw new Error("AZURE_OPENAI_RESOURCE_NAME is missing or invalid.");
    }
    return resource;
  }

  private apiVersion(): string {
    return Secrets.get(this.apiVersionName) || DEFAULT_API_VERSION;
  }
}
