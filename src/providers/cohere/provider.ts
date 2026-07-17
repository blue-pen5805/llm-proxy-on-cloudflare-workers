import {
  OpenAIChatCompletionsRequestBody,
  OpenAIModelsListResponseBody,
} from "../openai/types";
import { defineProvider, type Provider } from "../provider";
import { CohereModelsListResponseBody } from "./types";

export type Cohere = Provider;

export const Cohere = defineProvider({
  openAICompatible: true,
  apiKeyName: "COHERE_API_KEY",
  baseUrl: "https://api.cohere.com",
  chatCompletionPath: "/compatibility/v1/chat/completions",
  modelsPath: "/v1/models?page_size=100&endpoint=chat",
  chatCompletionSupportedParameters: [
    "messages",
    "model",
    "frequency_penalty",
    "max_tokens",
    "presence_penalty",
    "response_format",
    "seed",
    "stop",
    "stream",
    "temperature",
    "top_p",
    "tools",
  ] satisfies (keyof OpenAIChatCompletionsRequestBody)[],

  // Convert model list to OpenAI format
  convertModelsToOpenAIFormat(data): OpenAIModelsListResponseBody {
    const providerResponse = data as CohereModelsListResponseBody;
    return {
      object: "list",
      data: providerResponse.models.map(({ name, ...model }) => ({
        id: name,
        object: "model",
        created: 0,
        owned_by: "cohere",
        _: model,
      })),
    };
  },
});
