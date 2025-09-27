// Supported providers list for reference
export const CLOUDFLARE_AI_GATEWAY_SUPPORTED_PROVIDERS = [
  "anthropic",
  "openai",
  "groq",
  "mistral",
  "cohere",
  "perplexity-ai",
  "workers-ai",
  "google-ai-studio",
  "grok",
  "deepseek",
  "cerebras",
  "azure-openai",
  "aws-bedrock",
  "cartesia",
  "elevenlabs",
  "google-vertex-ai",
  "huggingface",
  "openrouter",
  "replicate",
] as const;

export type CloudflareAIGatewayProvider =
  (typeof CLOUDFLARE_AI_GATEWAY_SUPPORTED_PROVIDERS)[number];

// OpenAI compatible providers for the /compat/chat/completions endpoint
export const OPENAI_COMPATIBLE_PROVIDERS = [
  "anthropic",
  "openai",
  "groq",
  "mistral",
  "cohere",
  "perplexity-ai",
  "workers-ai",
  "google-ai-studio",
  "grok",
  "deepseek",
  "cerebras",
  "openrouter",
] as const;

export type CloudflareAIGatewayOpenAICompatibleProvider =
  (typeof OPENAI_COMPATIBLE_PROVIDERS)[number];

// https://developers.cloudflare.com/ai-gateway/glossary/
export type CloudflareAIGatewayHeaders = {
  /** Authentication Token for the AI Gateway, used to authorize requests. */
  "cf-aig-authorization"?: string;
  /** Header to customize the backoff type for request retries of a request. */
  "cf-aig-backoff"?: string;
  /** Override the default cache key in order to precisely set the cacheability setting for any resource. */
  "cf-aig-cache-key"?: string;
  /** Status indicator for caching, showing if a request was served from cache. */
  "cf-aig-cache-status"?: string;
  /** Specifies the cache time-to-live for responses. */
  "cf-aig-cache-ttl"?: string;
  /** Allows you to bypass the default log setting for the gateway. */
  "cf-aig-collect-log"?: string;
  /** Allows the customization of request cost to reflect user-defined parameters. */
  "cf-aig-custom-cost"?: string;
  /** Unique identifier for an event, used to trace specific events through the system. */
  "cf-aig-event-id"?: string;
  /** Unique identifier for the specific log entry to which you want to add feedback. */
  "cf-aig-log-id"?: string;
  /** Header to customize the number of max attempts for request retries of a request. */
  "cf-aig-max-attempts"?: string;
  /** Custom metadata allows you to tag requests with user IDs or other identifiers, enabling better tracking and analysis of your requests. */
  "cf-aig-metadata"?: string;
  /** Header to trigger a fallback provider based on a predetermined response time (measured in milliseconds). */
  "cf-aig-request-timeout"?: string;
  /** Header to customize the retry delay for request retries of a request. */
  "cf-aig-retry-delay"?: string;
  /** Header to bypass caching for a specific request. */
  "cf-aig-skip-cache"?: string;
  /** Identifies the processing step in the AI Gateway flow for better tracking and debugging. */
  "cf-aig-step"?: string;
  /** @deprecated This header is replaced by cf-aig-cache-ttl. It specifies cache time-to-live. */
  "cf-cache-ttl"?: string;
  /** @deprecated This header is replaced by cf-aig-skip-cache. It bypasses caching for a specific request. */
  "cf-skip-cache"?: string;
};

// Universal Endpoint
export type CloudflareAIGatewayUniversalEndpointHeaders =
  | {
      "Content-Type"?: string;
      Authorization?: string;
    }
  | CloudflareAIGatewayHeaders;
export type CloudflareAIGatewayUniversalEndpointStep = {
  provider: CloudflareAIGatewayProvider | "compat";
  endpoint: string;
  headers: CloudflareAIGatewayHeaders | Record<string, string>;
  config?: {
    requestTimeout?: number; // in milliseconds
    maxAttempts?: number;
    retryDelay?: number; // in milliseconds
    backoff?: "constant" | "linear" | "exponential";
  };
  query: Record<string, any>;
};
export type CloudflareAIGatewayUniversalEndpointData =
  | CloudflareAIGatewayUniversalEndpointStep
  | CloudflareAIGatewayUniversalEndpointStep[];
