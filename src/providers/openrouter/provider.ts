import { chatCompletionsEndpoint, jsonEndpoint } from "../inference";
import { OpenAIModelsListResponseBody } from "../openai/types";
import { defineProvider } from "../provider";
import { OpenRouterModelsListResponseBody } from "./types";

export const OpenRouter = defineProvider({
  endpoints: {
    chat_completions: chatCompletionsEndpoint("/v1/chat/completions"),
    responses: jsonEndpoint("/v1/responses"),
    messages: jsonEndpoint("/v1/messages"),
    models: {
      path: "/v1/models",
      convertResponse(data): OpenAIModelsListResponseBody {
        const providerResponse = data as OpenRouterModelsListResponseBody;
        return {
          object: "list",
          data: providerResponse.data.map(({ id, created, ...model }) => ({
            id,
            object: "model",
            created,
            owned_by: "openrouter",
            _: model,
          })),
        };
      },
    },
  },

  openAICompatible: true,
  apiKeyName: "OPENROUTER_API_KEY",
  baseUrl: "https://openrouter.ai/api",
});
