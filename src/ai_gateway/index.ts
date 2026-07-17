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
      ...(this.apiKey
        ? { "cf-aig-authorization": `Bearer ${this.apiKey}` }
        : {}),
      ...additionalHeaders,
    };
  }

  /**
   * Build a request for the Universal Endpoint of AI Gateway.
   * Supports fallbacks, request retries, and advanced configurations.
   * https://developers.cloudflare.com/ai-gateway/usage/universal/
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

  /** Build a request to AI Gateway's OpenAI-compatible chat endpoint. */
  buildCompatibilityEndpointRequest({
    headers = {},
    body,
    signal,
  }: {
    headers?: HeadersInit;
    body?: BodyInit | null;
    signal?: AbortSignal | null;
  }): [RequestInfo, RequestInit] {
    const gatewayHeaders = new Headers(this.buildHeaders());
    const additionalHeaders = new Headers(headers);
    additionalHeaders.forEach((value, key) => {
      gatewayHeaders.set(key, value);
    });

    const requestInit: RequestInit = {
      method: "POST",
      headers: gatewayHeaders,
      ...(body !== undefined && body !== null ? { body } : {}),
    };

    if (signal) {
      requestInit.signal = signal;
    }

    return [`${this.baseUrl()}/compat/chat/completions`, requestInit];
  }

  /**
   * Build a request for OpenAI-compatible chat completions.
   * https://developers.cloudflare.com/ai-gateway/chat-completion/
   */
  buildChatCompletionsRequests({
    provider,
    body,
    parsedBody,
    headers,
    apiKeys = [],
  }: {
    provider: CloudflareAIGatewayOpenAICompatibleProvider;
    body: string;
    parsedBody?: { model: string; [key: string]: unknown };
    headers: CloudflareAIGatewayHeaders | HeadersInit;
    apiKeys?: readonly string[];
  }): [RequestInfo, RequestInit][] {
    const requestData =
      parsedBody ??
      (JSON.parse(body) as {
        model: string;
        [key: string]: unknown;
      });

    // A missing provider key is valid when AI Gateway BYOK is configured. In
    // that case Gateway injects its stored credential for the upstream call.
    const credentials: readonly (string | undefined)[] =
      apiKeys.length > 0 ? apiKeys : [undefined];

    return credentials.map((apiKey) => {
      // Overwrite authorization header with the provider's API key
      const newHeaders = new Headers(headers);
      if (apiKey) {
        newHeaders.set("authorization", `Bearer ${apiKey}`);
      } else {
        newHeaders.delete("authorization");
      }

      // Convert Headers to plain object
      const headersObject: Record<string, string> = {};
      newHeaders.forEach((value, key) => {
        headersObject[key] = value;
      });

      return this.buildCompatibilityEndpointRequest({
        headers: headersObject,
        body: JSON.stringify({
          ...requestData,
          model: `${provider}/${requestData.model}`,
        }),
      });
    });
  }
}
