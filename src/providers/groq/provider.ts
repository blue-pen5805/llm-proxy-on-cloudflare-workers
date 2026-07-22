import {
  defineProvider,
  convertModelsToOpenAIFormatWithMetadata,
} from "../provider";
import { GroqModelsListResponseBody } from "./types";

export const Groq = defineProvider({
  openAICompatible: true,
  apiKeyName: "GROQ_API_KEY",
  baseUrl: "https://api.groq.com/openai/v1",
  // Convert model list to OpenAI format
  convertModelsToOpenAIFormat(
    data,
  ): ReturnType<typeof convertModelsToOpenAIFormatWithMetadata> {
    return convertModelsToOpenAIFormatWithMetadata(
      data as GroqModelsListResponseBody,
    );
  },
});
