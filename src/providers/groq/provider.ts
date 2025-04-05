import { Secrets } from "../../utils/secrets";
import { ProviderBase } from "../provider";
import { GroqEndpoint } from "./endpoint";
import { GroqModelsListResponseBody } from "./types";

export class Groq extends ProviderBase {
  readonly apiKeyName: keyof Env = "GROQ_API_KEY";

  endpoint: GroqEndpoint;

  constructor() {
    super();
    this.endpoint = new GroqEndpoint(Secrets.get(this.apiKeyName));
  }

  async listModels() {
    const response = await this.fetchModels();
    const data = (await response.json()) as GroqModelsListResponseBody;
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
