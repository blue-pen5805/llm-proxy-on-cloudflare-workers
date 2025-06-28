import { Secrets } from "../utils/secrets";
import {
  CloudflareAIGatewayHeaders,
  CloudflareAIGatewayOpenAICompatibleProvider,
  CloudflareAIGatewayProvider,
  CloudflareAIGatewayUniversalEndpointData,
  CloudflareAIGatewayUniversalEndpointHeaders,
} from "./const";
import {
  isCloudflareAIGatewayOpenAICompatibleProvider,
  isCloudflareAIGatewayProvider,
} from "./utils";

export class CloudflareAIGateway {
  static readonly origin = "https://gateway.ai.cloudflare.com/v1";

  static globalAccountId: string | undefined = undefined;
  static globalGatewayId: string | undefined = undefined;
  static globalApiKey: string | undefined = undefined;

  static configure(values: {
    accountId?: string | undefined;
    gatewayId?: string | undefined;
    apiKey?: string | undefined;
  }): void {
    if (values.hasOwnProperty("accountId")) {
      CloudflareAIGateway.globalAccountId = values.accountId;
    }
    if (values.hasOwnProperty("gatewayId")) {
      CloudflareAIGateway.globalGatewayId = values.gatewayId;
    }
    if (values.hasOwnProperty("apiKey")) {
      CloudflareAIGateway.globalApiKey = values.apiKey;
    }
  }

  static isAvailable(): boolean {
    return !!(
      CloudflareAIGateway.globalAccountId && CloudflareAIGateway.globalGatewayId
    );
  }

  static isSupportedProvider<T extends boolean = false>(
    providerName: string,
    hasOpenAiCompatibility?: T,
  ): providerName is T extends true
    ? CloudflareAIGatewayOpenAICompatibleProvider
    : CloudflareAIGatewayProvider {
    if (hasOpenAiCompatibility) {
      return isCloudflareAIGatewayOpenAICompatibleProvider(providerName);
    } else {
      return isCloudflareAIGatewayProvider(providerName);
    }
  }

  constructor(
    public accountId: string | undefined = undefined,
    public gatewayId: string | undefined = undefined,
    public apiKey: string | undefined = undefined,
  ) {
    this.accountId = accountId || CloudflareAIGateway.globalAccountId;
    this.gatewayId = gatewayId || CloudflareAIGateway.globalGatewayId;
    this.apiKey = apiKey || CloudflareAIGateway.globalApiKey;

    if (!this.accountId || !this.gatewayId) {
      throw new Error(
        "Cloudflare AI Gateway is not configured. Please set accountId, gatewayId.",
      );
    }
  }

  /**
   * Get the base URL for the AI Gateway.
   * If a provider is specified, it appends the provider to the URL.
   */
  baseUrl(provider: string | undefined = undefined): string {
    const url = `${CloudflareAIGateway.origin}/${this.accountId}/${this.gatewayId}`;
    return provider ? `${url}/${provider}` : url;
  }

  /**
   * Build headers for the AI Gateway request.
   * Includes the API key and any additional headers provided.
   */
  buildHeaders(additionalHeaders: HeadersInit = {}): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "cf-aig-authorization": `Bearer ${this.apiKey}` || "",
      ...additionalHeaders,
    };
  }

  /**
   * Build a request for the Universal Endpoint of AI Gateway.
   * Supports fallbacks, request retries, and advanced configurations
   * https://developers.cloudflare.com/ai-gateway/universal/
   */
  buildUniversalEndpointRequest({
    data,
    headers = {},
  }: {
    data: CloudflareAIGatewayUniversalEndpointData;
    headers?: CloudflareAIGatewayUniversalEndpointHeaders;
  }): [RequestInfo, RequestInit] {
    return [
      this.baseUrl(),
      {
        method: "POST",
        headers: this.buildHeaders(headers),
        body: JSON.stringify(data),
      },
    ];
  }

  /**
   * Build a request for a specific provider endpoint.
   * Example: /openai/chat/completions, /anthropic/v1/messages
   * https://developers.cloudflare.com/ai-gateway/providers/
   */
  buildProviderEndpointRequest({
    provider,
    method = "POST",
    path,
    body = null,
    headers = {},
  }: {
    provider: CloudflareAIGatewayProvider;
    method?: string;
    path: string;
    body?: BodyInit | null;
    headers?: CloudflareAIGatewayHeaders | HeadersInit;
  }): [RequestInfo, RequestInit] {
    const url = `${this.baseUrl(provider)}/${path.replace(/^\/+/, "")}`;

    return [
      url,
      {
        method,
        headers: this.buildHeaders(headers),
        body,
      },
    ];
  }

  /**
   * Build a request for OpenAI-compatible chat completions.
   * https://developers.cloudflare.com/ai-gateway/chat-completion/
   */
  buildChatCompletionsRequest({
    provider,
    body,
    headers,
    apiKeyName,
  }: {
    provider: CloudflareAIGatewayOpenAICompatibleProvider;
    body: string;
    headers: CloudflareAIGatewayHeaders | HeadersInit;
    apiKeyName: keyof Env;
  }): [RequestInfo, RequestInit] {
    const parsedBody = JSON.parse(body) as {
      model: string;
      [key: string]: any;
    };

    const apiKeys = Secrets.getAll(apiKeyName, true);
    const data: CloudflareAIGatewayUniversalEndpointData = apiKeys.map(
      (apiKey) => ({
        provider: "compat",
        endpoint: "chat/completions",
        headers: {
          ...headers,
          authorization: `Bearer ${apiKey}`,
        },
        query: {
          ...parsedBody,
          model: `${provider}/${parsedBody.model}`,
        },
      }),
    );

    return [
      this.baseUrl(),
      {
        method: "POST",
        headers: this.buildHeaders(headers),
        body: JSON.stringify(data),
      },
    ];
  }
}
