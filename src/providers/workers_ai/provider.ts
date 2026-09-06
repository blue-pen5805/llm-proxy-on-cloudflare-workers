import { isSafeCloudflareAccountId } from "../../ai_gateway/utils";
import { Secrets } from "../../utils/secrets";
import { chatCompletionsEndpoint, jsonEndpoint } from "../inference";
import { unsupportedNativeField } from "../native_request";
import { OpenAIModelsListResponseBody } from "../openai/types";
import { defineProvider, Provider, ProviderConstructor } from "../provider";
import { WorkersAiModelsListResponseBody } from "./types";

export type WorkersAi = Provider & { readonly accountIdName: keyof Env };

export const WorkersAi = defineProvider({
  endpoints: {
    chat_completions: chatCompletionsEndpoint("/v1/chat/completions", {
      transport: "workers-ai-rest",
      prepareGateway(data) {
        if (!data.model.startsWith("@cf/"))
          return unsupportedNativeField(
            "non-Workers-AI model selectors on workers-ai",
          );
        return { path: "/v1/chat/completions", data };
      },
    }),
    responses: jsonEndpoint(
      (data) => {
        if (!data.model.startsWith("@cf/"))
          return unsupportedNativeField(
            "non-Workers-AI model selectors on workers-ai",
          );
        return { path: "/v1/responses", data };
      },
      { requiresAiGateway: true, transport: "workers-ai-rest" },
    ),
    models: {
      path: "/models/search?task=Text%20Generation",
      convertResponse(data): OpenAIModelsListResponseBody {
        const providerResponse = data as WorkersAiModelsListResponseBody;
        return {
          object: "list",
          data: providerResponse.result.map(({ name, ...model }) => ({
            id: name,
            object: "model",
            created: 0,
            owned_by: "workers_ai",
            _: model,
          })),
        };
      },
    },
  },

  properties: { accountIdName: "CLOUDFLARE_ACCOUNT_ID" as keyof Env },
  apiKeyName: "CLOUDFLARE_API_KEY",

  available() {
    const { accountIdName } = this as WorkersAi;
    return (
      this.getApiKeys().length > 0 && Secrets.getAll(accountIdName).length > 0
    );
  },

  baseUrl() {
    const accountId = Secrets.get((this as WorkersAi).accountIdName);
    if (!isSafeCloudflareAccountId(accountId)) {
      throw new Error("CLOUDFLARE_ACCOUNT_ID is missing or invalid.");
    }
    return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai`;
  },
  configurationError() {
    const accountId = Secrets.get((this as WorkersAi).accountIdName);
    return accountId && !isSafeCloudflareAccountId(accountId)
      ? "CLOUDFLARE_ACCOUNT_ID is invalid."
      : undefined;
  },

  async headers(apiKeyIndex): Promise<HeadersInit> {
    const apiKey = Secrets.get(
      "CLOUDFLARE_API_KEY",
      apiKeyIndex,
      this.credentialProfile,
    );
    return {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    };
  },
}) as ProviderConstructor<[], WorkersAi>;
