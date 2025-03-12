import { EndpointBase } from "./endpoint";

export const AiGatewaySupportedProviders = [
  "workers-ai",
  "aws-bedrock",
  "anthropic",
  "azure-openai",
  "cartesia",
  "cerebras",
  "cohere",
  "deepseek",
  "elevenlabs",
  "google-ai-studio",
  "google-vertex-ai",
  "grok",
  "groq",
  "huggingface",
  "mistral",
  "openai",
  "openrouter",
  "perplexity-ai",
  "replicate",
];

export const OpenAICompatibleProviders = [
  "workers-ai",
  "anthropic",
  "cerebras",
  "cohere",
  "deepseek",
  "google-ai-studio",
  "grok",
  "groq",
  "mistral",
  "openai",
  "openrouter",
];

export const AiGatewayBasicEndpointPaths: { [key: string]: string } = {
  "workers-ai": "v1/chat/completions",
  // "aws-bedrock": "",
  anthropic: "v1/chat/completions",
  // "azure-openai": "chat/completions",
  cerebras: "chat/completions",
  cohere: "compatibility/v1/chat/completions",
  deepseek: "chat/completions",
  "google-ai-studio": "v1beta/openai/chat/completions",
  // "google-vertex-ai": "",
  grok: "v1/chat/completions",
  groq: "chat/completions",
  huggingface: "", // HuggingFace Chat Completion API is currently not supported by AI Gateway。
  mistral: "v1/chat/completions",
  openai: "chat/completions",
  openrouter: "chat/completions",
  // "perplexity-ai": "chat/completions",
  // replicate: "predictions",
};

export class AiGatewayEndpoint extends EndpointBase {
  static readonly origin = "https://gateway.ai.cloudflare.com/v1";

  static accountId: string | undefined = undefined;
  static gatewayId: string | undefined = undefined;
  static apiKey: string | undefined;

  providerName: string | undefined;
  destination: EndpointBase | undefined;

  static configure(accountId: string, gatewayId: string, apiKey?: string) {
    AiGatewayEndpoint.accountId = accountId;
    AiGatewayEndpoint.gatewayId = gatewayId;
    AiGatewayEndpoint.apiKey = apiKey;
  }

  static isActive(providerName?: string): boolean {
    return (
      AiGatewayEndpoint.accountId !== undefined &&
      AiGatewayEndpoint.gatewayId !== undefined &&
      (providerName === undefined ||
        AiGatewaySupportedProviders.includes(providerName))
    );
  }

  constructor(
    providerName: string | undefined = undefined,
    destination: EndpointBase | undefined = undefined,
  ) {
    super();
    this.providerName = providerName;
    this.destination = destination;
  }

  available(): boolean {
    if (!AiGatewayEndpoint.isActive(this.providerName)) return false;

    return this.destination?.available() || false;
  }

  baseUrl() {
    const url = `${AiGatewayEndpoint.origin}/${AiGatewayEndpoint.accountId}/${AiGatewayEndpoint.gatewayId}`;

    return this.providerName ? `${url}/${this.providerName}` : url;
  }

  pathnamePrefix(): string {
    return this.destination?.pathnamePrefix() || "";
  }

  headers() {
    const headers: HeadersInit = {
      "Content-Type": "application/json",
      ...this.destination?.headers(),
    };

    if (AiGatewayEndpoint.apiKey) {
      headers["cf-aig-authorization"] = `Bearer ${AiGatewayEndpoint.apiKey}`;
    }

    return headers;
  }
}
