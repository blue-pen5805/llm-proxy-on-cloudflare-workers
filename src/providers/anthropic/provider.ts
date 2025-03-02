import { OpenAIChatCompletionsRequestBody } from "../openai/types";
import { ProviderBase } from "../provider";
import { AnthropicEndpoint } from "./endpoint";
import { AnthropicModelsListResponseBody } from "./types";

export class Anthropic extends ProviderBase {
  endpoint: AnthropicEndpoint;

  constructor({ apiKey }: { apiKey: keyof Env }) {
    super({ apiKey });
    this.endpoint = new AnthropicEndpoint(apiKey);
  }

  // OpenAI ComaptiQble API - Chat Completions
  chatCompletionsRequestData({
    body,
    headers = {},
  }: {
    body: string;
    headers: HeadersInit;
  }) {
    return this.endpoint.requestData("/v1/chat/completions", {
      method: "POST",
      headers,
      body: this.chatCompletionsRequestBody(body),
    });
  }

  chatCompletionsRequestBody(body: string): string {
    const trimmedData = JSON.parse(super.chatCompletionsRequestBody(body));
    if (trimmedData["max_tokens"] === undefined)
      trimmedData["max_tokens"] = 1024;

    return JSON.stringify(trimmedData);
  }

  async listModels() {
    const response = await this.fetchModels();
    const data = (await response.json()) as AnthropicModelsListResponseBody;

    return {
      object: "list",
      data: data.data.map(({ id, type, created_at, ...model }) => ({
        id,
        object: type,
        created: Math.floor(Date.parse(created_at) / 1000),
        owned_by: "anthropic",
        _: model,
      })),
    };
  }

  fetchModels(): Promise<Response> {
    return this.fetch("/v1/models", {
      method: "GET",
    });
  }
}
