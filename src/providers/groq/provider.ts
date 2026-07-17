import {
  modelsToOpenAIFormatWithMetadata,
  OpenAICompatibleProvider,
} from "../provider";
import { GroqModelsListResponseBody } from "./types";

export class Groq extends OpenAICompatibleProvider {
  readonly apiKeyName: keyof Env = "GROQ_API_KEY";
  readonly baseUrlProp: string = "https://api.groq.com/openai/v1";

  // Convert model list to OpenAI format
  modelsToOpenAIFormat(
    data: GroqModelsListResponseBody,
  ): ReturnType<typeof modelsToOpenAIFormatWithMetadata> {
    return modelsToOpenAIFormatWithMetadata(data);
  }
}
