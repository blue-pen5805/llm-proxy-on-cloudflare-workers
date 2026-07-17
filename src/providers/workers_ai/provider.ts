import { isSafeCloudflareAccountId } from "../../ai_gateway/utils";
import { Secrets } from "../../utils/secrets";
import { OpenAIModelsListResponseBody } from "../openai/types";
import { defineProvider, Provider, ProviderConstructor } from "../provider";
import { WorkersAiModelsListResponseBody } from "./types";

export type WorkersAi = Provider & { readonly accountIdName: keyof Env };

export const WorkersAi = defineProvider({
  properties: { accountIdName: "CLOUDFLARE_ACCOUNT_ID" as keyof Env },
  apiKeyName: "CLOUDFLARE_API_KEY",
  chatCompletionPath: "/v1/chat/completions",
  modelsPath: "/models/search?task=Text Generation",
  available() {
    const { accountIdName } = this as WorkersAi;
    return (
      Secrets.getAll("CLOUDFLARE_API_KEY").length > 0 &&
      Secrets.getAll(accountIdName).length > 0
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
    const apiKey = Secrets.get("CLOUDFLARE_API_KEY", apiKeyIndex);
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };
  },

  // Convert model list to OpenAI format
  convertModelsToOpenAIFormat(data): OpenAIModelsListResponseBody {
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
}) as ProviderConstructor<[], WorkersAi>;
