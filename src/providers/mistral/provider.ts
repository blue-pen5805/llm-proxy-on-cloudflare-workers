import { OpenAIModelsListResponseBody } from "../openai/types";
import { ProviderBase } from "../provider";
import { MistralEndpoint } from "./endpoint";
import { MistralModelsListResponseBody } from "./types";

export class Mistral extends ProviderBase {
  readonly chatCompletionPath: string = "/v1/chat/completions";
  readonly modelsPath: string = "/v1/models";

  readonly apiKeyName: keyof Env = "MISTRAL_API_KEY";

  endpoint: MistralEndpoint;

  constructor() {
    super();
    this.endpoint = new MistralEndpoint(this.apiKeyName);
  }

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
