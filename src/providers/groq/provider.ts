import { chatCompletionsEndpoint, jsonEndpoint } from "../inference";
import { convertModelsToOpenAIFormatWithMetadata } from "../models";
import { defineProvider } from "../provider";
import { GroqModelsListResponseBody } from "./types";

export const Groq = defineProvider({
  endpoints: {
    chat_completions: chatCompletionsEndpoint(),
    responses: jsonEndpoint("/responses"),
    models: {
      path: "/models",
      convertResponse(
        data,
      ): ReturnType<typeof convertModelsToOpenAIFormatWithMetadata> {
        return convertModelsToOpenAIFormatWithMetadata(
          data as GroqModelsListResponseBody,
        );
      },
    },
  },

  openAICompatible: true,
  apiKeyName: "GROQ_API_KEY",
  baseUrl: "https://api.groq.com/openai/v1",
});
