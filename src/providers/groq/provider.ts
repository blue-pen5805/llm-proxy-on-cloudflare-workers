import { ProviderBase } from "../provider";
import { GroqEndpoint } from "./endpoint";
import { GroqModelsListResponseBody } from "./types";

export class Groq extends ProviderBase {
  endpoint: GroqEndpoint;

  constructor({ apiKey }: { apiKey: keyof Env }) {
    super({ apiKey });
    this.endpoint = new GroqEndpoint(apiKey);
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
