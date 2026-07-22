import {
  defineProvider,
  convertModelsToOpenAIFormatWithMetadata,
} from "../provider";
import { MistralModelsListResponseBody } from "./types";

export const Mistral = defineProvider({
  openAICompatible: true,
  apiKeyName: "MISTRAL_API_KEY",
  baseUrl: "https://api.mistral.ai",
  chatCompletionPath: "/v1/chat/completions",
  modelsPath: "/v1/models",
  // Convert model list to OpenAI format
  convertModelsToOpenAIFormat(
    data,
  ): ReturnType<typeof convertModelsToOpenAIFormatWithMetadata> {
    return convertModelsToOpenAIFormatWithMetadata(
      data as MistralModelsListResponseBody,
    );
  },
});
