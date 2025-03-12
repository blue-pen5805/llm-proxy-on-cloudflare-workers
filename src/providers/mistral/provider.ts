import { ProviderBase } from "../provider";
import { MistralEndpoint } from "./endpoint";
import { MistralModelsListResponseBody } from "./types";

export class Mistral extends ProviderBase {
  readonly chatCompletionPath: string = "/v1/chat/completions";
  readonly modelsPath: string = "/v1/models";

  endpoint: MistralEndpoint;

  constructor({ apiKey }: { apiKey: keyof Env }) {
    super({ apiKey });
    this.endpoint = new MistralEndpoint(apiKey);
  }

  async listModels() {
    const response = await this.fetchModels();
    const data = (await response.json()) as MistralModelsListResponseBody;
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
