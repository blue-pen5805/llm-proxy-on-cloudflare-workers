import { OpenAIModelsListResponseBody } from "../openai/types";
import { ProviderBase } from "../provider";
import { GroqEndpoint } from "./endpoint";
import { GroqModelsListResponseBody } from "./types";

export class Groq extends ProviderBase {
  readonly apiKeyName: keyof Env = "GROQ_API_KEY";

  endpoint: GroqEndpoint;

  constructor() {
    super();
    this.endpoint = new GroqEndpoint(this.apiKeyName);
  }

  // Convert model list to OpenAI format
  modelsToOpenAIFormat(
    data: GroqModelsListResponseBody,
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
