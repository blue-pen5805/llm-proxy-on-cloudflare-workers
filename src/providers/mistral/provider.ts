import { OpenAIModelsListResponseBody } from "../openai/types";
import { OpenAICompatibleProvider } from "../provider";
import { MistralModelsListResponseBody } from "./types";

export class Mistral extends OpenAICompatibleProvider {
  readonly chatCompletionPath: string = "/v1/chat/completions";
  readonly modelsPath: string = "/v1/models";

  readonly apiKeyName: keyof Env = "MISTRAL_API_KEY";
  readonly baseUrlProp: string = "https://api.mistral.ai";

  // Convert model list to OpenAI format
  modelsToOpenAIFormat(
    data: MistralModelsListResponseBody,
  ): OpenAIModelsListResponseBody {
    return {
      object: "list",
      data: data.data.map(({ id, object, created, owned_by, ...model }) => ({
        id,
        object,
        created,
        owned_by,
        _: model,
      })),
    };
  }
}
