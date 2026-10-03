import { Secrets } from "../../utils/secrets";
import {
  chatCompletionsEndpoint,
  convertedChatEndpoint,
  jsonEndpoint,
} from "../inference";
import { converseEndpoint } from "../native";
import {
  defineProvider,
  Provider,
  ProviderConstructor,
  ProviderNotSupportedError,
} from "../provider";

const REGION_PATTERN = /^[a-z]{2}(?:-gov)?-[a-z]+-\d$/;

export type AwsBedrock = Provider & { readonly regionName: keyof Env };

function getAwsRegionName(provider: AwsBedrock): string {
  const regionName = Secrets.get(provider.regionName);
  if (!REGION_PATTERN.test(regionName)) {
    throw new Error("AWS_BEDROCK_REGION is missing or invalid.");
  }
  return regionName;
}

const openAiEndpoint = chatCompletionsEndpoint("/openai/v1/chat/completions", {
  usePathnamePrefix: false,
});
const isOpenAiModel = (model: string) =>
  /^(?:(?:us|us-gov|eu|apac|global)\.)?openai\./.test(model);

const isAnthropicModel = (model: string) =>
  /^(?:(?:us|us-gov|eu|apac|global)\.)?anthropic\./.test(model);
const compatibleChatEndpoint = jsonEndpoint("/v1/chat/completions", {
  usePathnamePrefix: false,
});
const responsesEndpoint = jsonEndpoint("/openai/v1/responses", {
  usePathnamePrefix: false,
});
const nativeMessagesEndpoint = jsonEndpoint("/anthropic/v1/messages", {
  usePathnamePrefix: false,
});

export const AwsBedrock = defineProvider({
  endpoints: {
    models: {
      requiresProviderCredentials: true,
      path: "/models",
      validate() {
        if (!Secrets.get((this as AwsBedrock).regionName)) {
          throw new ProviderNotSupportedError(
            "Amazon Bedrock model discovery requires AWS_BEDROCK_REGION.",
          );
        }
      },
    },
  },

  resolveEndpoint(model, protocol) {
    if (isOpenAiModel(model)) {
      if (protocol === "chat_completions") return openAiEndpoint;
      if (protocol === "responses") return responsesEndpoint;
    }
    if (isAnthropicModel(model)) {
      if (protocol === "chat_completions") return compatibleChatEndpoint;
      if (protocol === "messages") return nativeMessagesEndpoint;
    }
    return undefined;
  },
  chatFallback: convertedChatEndpoint(converseEndpoint),
  resolveChatFallback(model) {
    return isOpenAiModel(model) ? openAiEndpoint : undefined;
  },
  properties: { regionName: "AWS_BEDROCK_REGION" as keyof Env },
  openAICompatible: true,
  apiKeyName: "AWS_BEARER_TOKEN_BEDROCK",
  pathnamePrefix: "/v1",
  available() {
    return (
      this.getApiKeys().length > 0 &&
      REGION_PATTERN.test(Secrets.get((this as AwsBedrock).regionName))
    );
  },
  baseUrl() {
    return `https://bedrock-runtime.${getAwsRegionName(this as AwsBedrock)}.amazonaws.com`;
  },

  async buildHeadersForPath(pathname, headers, apiKeyIndex) {
    const merged = new Headers(headers);
    new Headers(await this.headers(apiKeyIndex)).forEach((value, key) =>
      merged.set(key, value),
    );
    if (pathname.startsWith("/anthropic/v1/messages")) {
      const authorization = merged.get("authorization");
      merged.delete("authorization");
      if (authorization)
        merged.set("x-api-key", authorization.slice("Bearer ".length));
      if (!merged.has("anthropic-version"))
        merged.set("anthropic-version", "2023-06-01");
    }
    return merged;
  },

  aiGatewayPath(pathname: string): string {
    return `/bedrock-runtime/${encodeURIComponent(getAwsRegionName(this as AwsBedrock))}/${pathname.replace(/^\/+/, "")}`;
  },
}) as ProviderConstructor<[], AwsBedrock>;
