import { ProviderBase } from "../provider";
import { WorkersAiEndpoint } from "./endpoint";
import { WorkersAiModelsListResponseBody } from "./types";

export class WorkersAi extends ProviderBase {
  readonly chatCompletionPath: string = "/v1/chat/completions";
  readonly modelsPath: string = "/models/search?task=Text Generation";

  endpoint: WorkersAiEndpoint;

  constructor({
    apiKey,
    accountId,
  }: {
    apiKey: keyof Env;
    accountId: keyof Env;
  }) {
    super({ apiKey });
    this.endpoint = new WorkersAiEndpoint(apiKey, accountId);
  }

  async listModels() {
    const response = await this.fetchModels();
    const data = (await response.json()) as WorkersAiModelsListResponseBody;

    return {
      object: "list",
      data: data.result.map(({ name, ...model }) => ({
        id: name,
        object: "model",
        created: 0,
        owned_by: "workers_ai",
        _: model,
      })),
    };
  }
}
