import { MAX_COMPATIBILITY_FALLBACK_ATTEMPTS } from "../requests/compatibility_fallback";
import { BadRequestError } from "../utils/error";
import {
  CloudflareAIGatewayHeaders,
  CloudflareAIGatewayOpenAICompatibleProvider,
  CloudflareAIGatewayProvider,
  CloudflareAIGatewayRestApiPath,
  CloudflareAIGatewayUniversalEndpointData,
  CloudflareAIGatewayUniversalEndpointHeaders,
} from "./const";
import {
  isSafeCloudflareAccountId,
  isSafeCloudflareAIGatewayId,
  isCloudflareAIGatewayOpenAICompatibleProvider,
  isCloudflareAIGatewayProvider,
} from "./utils";

export class CloudflareAIGateway {
  static readonly origin = "https://gateway.ai.cloudflare.com/v1";
  static readonly restApiOrigin =
    "https://api.cloudflare.com/client/v4/accounts";

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
    public restApiToken: string | undefined = undefined,
    public alwaysUse: boolean = false,
  ) {
    if (
      !isSafeCloudflareAccountId(this.accountId) ||
      !isSafeCloudflareAIGatewayId(this.gatewayId)
    ) {
      throw new Error(
        "Cloudflare AI Gateway accountId or gatewayId is invalid.",
      );
    }
  }

  /**
   * Get the base URL for the AI Gateway.
   * If a provider is specified, it appends the provider to the URL.
   */
  baseUrl(provider: string | undefined = undefined): string {
    const gatewayBaseUrl = `${CloudflareAIGateway.origin}/${encodeURIComponent(this.accountId)}/${encodeURIComponent(this.gatewayId)}`;
    return provider ? `${gatewayBaseUrl}/${provider}` : gatewayBaseUrl;
  }

  /**
   * Build headers for the AI Gateway request.
   * Includes the API key and any additional headers provided.
   */
  buildHeaders(additionalHeaders: HeadersInit = {}): HeadersInit {
    const headers = new Headers(additionalHeaders);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    if (this.apiKey) {
      headers.set("cf-aig-authorization", `Bearer ${this.apiKey}`);
    }
    return headers;
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
    provider: string;
    method?: string;
    path: string;
    body?: BodyInit | null;
    headers?: CloudflareAIGatewayHeaders | HeadersInit;
  }): [RequestInfo, RequestInit] {
    const providerEndpointUrl = `${this.baseUrl(provider)}/${path.replace(/^\/+/, "")}`;

    return [
      providerEndpointUrl,
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
    const gatewayHeaders = new Headers(this.buildHeaders(headers));

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

  /** Build a request to one of AI Gateway's account-level REST API routes. */
  buildRestApiRequest({
    path,
    headers = {},
    body,
    signal,
  }: {
    path: CloudflareAIGatewayRestApiPath;
    headers?: HeadersInit;
    body?: BodyInit | null;
    signal?: AbortSignal | null;
  }): [RequestInfo, RequestInit] {
    if (!this.restApiToken) {
      throw new BadRequestError(
        "AI Gateway REST API requires CLOUDFLARE_API_TOKEN.",
      );
    }

    const restHeaders = new Headers(headers);
    if (!restHeaders.has("content-type")) {
      restHeaders.set("content-type", "application/json");
    }
    restHeaders.set("authorization", `Bearer ${this.restApiToken}`);
    restHeaders.set("cf-aig-gateway-id", this.gatewayId);

    const requestInit: RequestInit = {
      method: "POST",
      headers: restHeaders,
      ...(body !== undefined && body !== null ? { body } : {}),
    };
    if (signal) {
      requestInit.signal = signal;
    }

    return [
      `${CloudflareAIGateway.restApiOrigin}/${encodeURIComponent(this.accountId)}${path}`,
      requestInit,
    ];
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
    const chatRequestBody =
      parsedBody ??
      (JSON.parse(body) as {
        model: string;
        [key: string]: unknown;
      });

    // A missing provider key is valid when AI Gateway BYOK is configured. In
    // that case Gateway injects its stored credential for the upstream call.
    const credentials: readonly (string | undefined)[] =
      apiKeys.length > 0
        ? apiKeys.slice(0, MAX_COMPATIBILITY_FALLBACK_ATTEMPTS)
        : [undefined];

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
          ...chatRequestBody,
          model: `${provider}/${chatRequestBody.model}`,
        }),
      });
    });
  }
}
