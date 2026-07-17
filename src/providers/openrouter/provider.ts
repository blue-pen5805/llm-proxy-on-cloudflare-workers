import { OpenAIModelsListResponseBody } from "../openai/types";
import { defineProvider, type Provider } from "../provider";
import { OpenRouterModelsListResponseBody } from "./types";

export type OpenRouter = Provider;

export const OpenRouter = defineProvider({
  openAICompatible: true,
  apiKeyName: "OPENROUTER_API_KEY",
  baseUrl: "https://openrouter.ai/api",
  chatCompletionPath: "/v1/chat/completions",
  modelsPath: "/v1/models",
  // Convert model list to OpenAI format
  modelsToOpenAIFormat(data): OpenAIModelsListResponseBody {
    const response = data as OpenRouterModelsListResponseBody;
    return {
      object: "list",
      data: response.data.map(({ id, created, ...model }) => ({
        id,
        object: "model",
        created,
        owned_by: "openrouter",
        _: model,
      })),
    };
  },
});
