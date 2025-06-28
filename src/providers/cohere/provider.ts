import { ProviderBase } from "../provider";
import { CohereEndpoint } from "./endpoint";
import { CohereModelsListResponseBody } from "./types";
import {
  OpenAIChatCompletionsRequestBody,
  OpenAIModelsListResponseBody,
} from "../openai/types";
import { Secrets } from "../../utils/secrets";

export class Cohere extends ProviderBase {
  readonly chatCompletionPath: string = "/compatibility/v1/chat/completions";
  readonly modelsPath: string = "/v1/models?page_size=100&endpoint=chat";

  readonly apiKeyName: keyof Env = "COHERE_API_KEY";

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

  endpoint: CohereEndpoint;

  constructor() {
    super();
    this.endpoint = new CohereEndpoint(Secrets.get(this.apiKeyName));
  }

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
