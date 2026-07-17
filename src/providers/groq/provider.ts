import {
  defineProvider,
  modelsToOpenAIFormatWithMetadata,
  type Provider,
} from "../provider";
import { GroqModelsListResponseBody } from "./types";

export type Groq = Provider;

export const Groq = defineProvider({
  openAICompatible: true,
  apiKeyName: "GROQ_API_KEY",
  baseUrl: "https://api.groq.com/openai/v1",
  // Convert model list to OpenAI format
  modelsToOpenAIFormat(
    data,
  ): ReturnType<typeof modelsToOpenAIFormatWithMetadata> {
    return modelsToOpenAIFormatWithMetadata(data as GroqModelsListResponseBody);
  },
});
