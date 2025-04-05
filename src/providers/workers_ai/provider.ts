import { Secrets } from "../../utils/secrets";
import { ProviderBase } from "../provider";
import { WorkersAiEndpoint } from "./endpoint";
import { WorkersAiModelsListResponseBody } from "./types";

export class WorkersAi extends ProviderBase {
  readonly chatCompletionPath: string = "/v1/chat/completions";
  readonly modelsPath: string = "/models/search?task=Text Generation";

  readonly apiKeyName: keyof Env = "CLOUDFLARE_API_KEY";
  readonly accountIdName: keyof Env = "CLOUDFLARE_ACCOUNT_ID";

  endpoint: WorkersAiEndpoint;

  constructor() {
    super();
    this.endpoint = new WorkersAiEndpoint(
      Secrets.get(this.apiKeyName),
      Secrets.get(this.accountIdName),
    );
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
