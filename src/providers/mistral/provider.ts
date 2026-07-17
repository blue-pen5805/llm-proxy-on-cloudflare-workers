import {
  modelsToOpenAIFormatWithMetadata,
  OpenAICompatibleProvider,
} from "../provider";
import { MistralModelsListResponseBody } from "./types";

export class Mistral extends OpenAICompatibleProvider {
  get chatCompletionPath(): string {
    return "/v1/chat/completions";
  }
  get modelsPath(): string {
    return "/v1/models";
  }

  readonly apiKeyName: keyof Env = "MISTRAL_API_KEY";
  readonly baseUrlProp: string = "https://api.mistral.ai";

  // Convert model list to OpenAI format
  modelsToOpenAIFormat(
    data: MistralModelsListResponseBody,
  ): ReturnType<typeof modelsToOpenAIFormatWithMetadata> {
    return modelsToOpenAIFormatWithMetadata(data);
  }
}
