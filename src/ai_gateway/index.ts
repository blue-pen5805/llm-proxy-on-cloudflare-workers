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
    public accountId: string,
    public gatewayId: string,
    public apiKey: string | undefined = undefined,
  ) {
    if (!this.accountId || !this.gatewayId) {
      throw new Error(
        "Cloudflare AI Gateway configuration is incomplete. accountId and gatewayId are required.",
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
  buildHeaders(additionalHeaders: HeadersInit = {}): HeadersInit {
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

  buildCompatRequest({
    path,
    method,
    headers = {},
    body,
    signal,
  }: {
    path: string;
    method: string;
    headers?: HeadersInit;
    body?: BodyInit | null;
    signal?: AbortSignal | null;
  }): [RequestInfo, RequestInit] {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;

    const gatewayHeaders = new Headers(this.buildHeaders());
    const additionalHeaders = new Headers(headers);
    additionalHeaders.forEach((value, key) => {
      gatewayHeaders.set(key, value);
    });

    const upperMethod = method.toUpperCase();
    const requestInit: RequestInit = {
      method,
      headers: gatewayHeaders,
      ...(body !== undefined &&
      body !== null &&
      upperMethod !== "GET" &&
      upperMethod !== "HEAD"
        ? { body }
        : {}),
    };

    if (signal) {
      requestInit.signal = signal;
    }

    return [`${this.baseUrl()}${normalizedPath}`, requestInit];
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
      (apiKey) => {
        // Overwrite authorization header with the provider's API key
        const newHeaders = new Headers(headers);
        newHeaders.set("authorization", `Bearer ${apiKey}`);

        // Convert Headers to plain object
        const headersObject: Record<string, string> = {};
        newHeaders.forEach((value, key) => {
          headersObject[key] = value;
        });

        return {
          provider: "compat",
          endpoint: "chat/completions",
          headers: headersObject,
          query: {
            ...parsedBody,
            model: `${provider}/${parsedBody.model}`,
          },
        };
      },
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
