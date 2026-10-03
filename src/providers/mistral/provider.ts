import { chatCompletionsEndpoint } from "../inference";
import { convertModelsToOpenAIFormatWithMetadata } from "../models";
import { defineProvider } from "../provider";
import { MistralModelsListResponseBody } from "./types";

export const Mistral = defineProvider({
  endpoints: {
    chat_completions: chatCompletionsEndpoint("/v1/chat/completions"),

    models: {
      path: "/v1/models",
      convertResponse(
        data,
      ): ReturnType<typeof convertModelsToOpenAIFormatWithMetadata> {
        return convertModelsToOpenAIFormatWithMetadata(
          data as MistralModelsListResponseBody,
        );
      },
    },
  },

  openAICompatible: true,
  apiKeyName: "MISTRAL_API_KEY",
  baseUrl: "https://api.mistral.ai",
});
