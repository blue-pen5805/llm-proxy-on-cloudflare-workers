import { OpenAIModelsListResponseBody } from "../openai/types";
import { OpenAICompatibleProvider } from "../provider";
import { GroqModelsListResponseBody } from "./types";

export class Groq extends OpenAICompatibleProvider {
  readonly apiKeyName: keyof Env = "GROQ_API_KEY";
  readonly baseUrlProp: string = "https://api.groq.com/openai/v1";

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
