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
    return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai`;
  },

  async headers(apiKeyIndex): Promise<HeadersInit> {
    const apiKey = Secrets.get("CLOUDFLARE_API_KEY", apiKeyIndex);
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };
  },

  // Convert model list to OpenAI format
  modelsToOpenAIFormat(data): OpenAIModelsListResponseBody {
    const response = data as WorkersAiModelsListResponseBody;
    return {
      object: "list",
      data: response.result.map(({ name, ...model }) => ({
        id: name,
        object: "model",
        created: 0,
        owned_by: "workers_ai",
        _: model,
      })),
    };
  },
}) as ProviderConstructor<[], WorkersAi>;
