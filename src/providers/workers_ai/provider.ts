import { Secrets } from "../../utils/secrets";
import { OpenAIModelsListResponseBody } from "../openai/types";
import { ProviderBase } from "../provider";
import { WorkersAiModelsListResponseBody } from "./types";

export class WorkersAi extends ProviderBase {
  get chatCompletionPath(): string {
    return "/v1/chat/completions";
  }
  get modelsPath(): string {
    return "/models/search?task=Text Generation";
  }

  readonly apiKeyName: keyof Env = "CLOUDFLARE_API_KEY";
  readonly accountIdName: keyof Env = "CLOUDFLARE_ACCOUNT_ID";

  available() {
    return (
      Secrets.getAll(this.apiKeyName).length > 0 &&
      Secrets.getAll(this.accountIdName).length > 0
    );
  }

  baseUrl() {
    const accountId = Secrets.get(this.accountIdName);
    return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai`;
  }

  async headers(apiKeyIndex?: number): Promise<HeadersInit> {
    const apiKey = Secrets.get(this.apiKeyName, apiKeyIndex);
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };
  }

  // Convert model list to OpenAI format
  modelsToOpenAIFormat(
    data: WorkersAiModelsListResponseBody,
  ): OpenAIModelsListResponseBody {
    return {
      object: "list",
      data: data.result.map(({ name, ...model }) => ({
        id: name,
        object: "model",
        created: 0,
        owned_by: "workers_ai",
        _: model,
      })),
    };
  }
}
