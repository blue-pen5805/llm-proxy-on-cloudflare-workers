import {
  defineProvider,
  modelsToOpenAIFormatWithMetadata,
  type Provider,
} from "../provider";
import { MistralModelsListResponseBody } from "./types";

export type Mistral = Provider;

export const Mistral = defineProvider({
  openAICompatible: true,
  apiKeyName: "MISTRAL_API_KEY",
  baseUrl: "https://api.mistral.ai",
  chatCompletionPath: "/v1/chat/completions",
  modelsPath: "/v1/models",
  // Convert model list to OpenAI format
  modelsToOpenAIFormat(
    data,
  ): ReturnType<typeof modelsToOpenAIFormatWithMetadata> {
    return modelsToOpenAIFormatWithMetadata(
      data as MistralModelsListResponseBody,
    );
  },
});
