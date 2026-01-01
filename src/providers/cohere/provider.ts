import {
  OpenAIChatCompletionsRequestBody,
  OpenAIModelsListResponseBody,
} from "../openai/types";
import { OpenAICompatibleProvider } from "../provider";
import { CohereModelsListResponseBody } from "./types";

export class Cohere extends OpenAICompatibleProvider {
  get chatCompletionPath(): string {
    return "/compatibility/v1/chat/completions";
  }
  get modelsPath(): string {
    return "/v1/models?page_size=100&endpoint=chat";
  }

  readonly apiKeyName: keyof Env = "COHERE_API_KEY";
  readonly baseUrlProp: string = "https://api.cohere.com";

  readonly CHAT_COMPLETIONS_SUPPORTED_PARAMETERS: (keyof OpenAIChatCompletionsRequestBody)[] =
    [
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
    ];

  // Convert model list to OpenAI format
  modelsToOpenAIFormat(
    data: CohereModelsListResponseBody,
  ): OpenAIModelsListResponseBody {
    return {
      object: "list",
      data: data.models.map(({ name, ...model }) => ({
        id: name,
        object: "model",
        created: 0,
        owned_by: "cohere",
        _: model,
      })),
    };
  }
}
