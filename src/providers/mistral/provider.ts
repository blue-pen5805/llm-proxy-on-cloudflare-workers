import { ProviderBase } from "../provider";
import { MistralEndpoint } from "./endpoint";
import { MistralModelsListResponseBody } from "./types";

export class Mistral extends ProviderBase {
  endpoint: MistralEndpoint;

  constructor({ apiKey }: { apiKey: keyof Env }) {
    super({ apiKey });
    this.endpoint = new MistralEndpoint(apiKey);
  }

  chatCompletionsRequestData({
    body,
    headers,
  }: {
    body: string;
    headers: HeadersInit;
  }) {
    return this.endpoint.requestData("/v1/chat/completions", {
      method: "POST",
      headers,
      body,
    });
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

  fetchModels() {
    return this.fetch("/v1/models", {
      method: "GET",
    });
  }
}
