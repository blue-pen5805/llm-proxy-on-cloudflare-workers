import { ProviderBase } from "../provider";
import { WorkersAiEndpoint } from "./endpoint";
import { WorkersAiModelsListResponseBody } from "./types";

export class WorkersAi extends ProviderBase {
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

  // OpenAI Comaptible API - Chat Completions
  chatCompletionsRequestData({
    body,
    headers,
  }: {
    body: string;
    headers: HeadersInit;
  }) {
    return this.endpoint.requestData("v1/chat/completions", {
      method: "POST",
      headers,
      body,
    });
  }

  // OpenAI Comaptible API - Models
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

  fetchModels() {
    return this.fetch("/models/search?task=Text Generation", {
      method: "GET",
    });
  }
}
