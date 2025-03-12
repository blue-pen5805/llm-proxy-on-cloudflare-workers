import { ProviderBase } from "../provider";
import { OpenRouterEndpoint } from "./endpoint";
import { OpenRouterModelsListResponseBody } from "./types";

export class OpenRouter extends ProviderBase {
  endpoint: OpenRouterEndpoint;

  constructor({ apiKey }: { apiKey: keyof Env }) {
    super({ apiKey });
    this.endpoint = new OpenRouterEndpoint(apiKey);
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
    const data = (await response.json()) as OpenRouterModelsListResponseBody;
    return {
      object: "list",
      data: data.data.map(({ id, created, ...model }) => ({
        id,
        object: "model",
        created,
        owned_by: "openrouter",
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
