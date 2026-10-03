import { chatCompletionsEndpoint } from "../inference";
import {
  OpenAIChatCompletionsRequestBody,
  OpenAIModelsListResponseBody,
} from "../openai/types";
import { defineProvider } from "../provider";
import { CohereModelsListResponseBody } from "./types";

export const Cohere = defineProvider({
  endpoints: {
    chat_completions: chatCompletionsEndpoint(
      "/compatibility/v1/chat/completions",
      {
        supportedParameters: [
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
      },
    ),

    models: {
      path: "/v1/models?page_size=100&endpoint=chat",
      convertResponse(data): OpenAIModelsListResponseBody {
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
    },
  },

  openAICompatible: true,
  apiKeyName: "COHERE_API_KEY",
  baseUrl: "https://api.cohere.com",
});
