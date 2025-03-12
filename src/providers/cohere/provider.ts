import { ProviderBase } from "../provider";
import { CohereEndpoint, CohereOpenAICompatibleEndpoint } from "./endpoint";
import { CohereModelsListResponseBody } from "./types";
import { OpenAIChatCompletionsRequestBody } from "../openai/types";

export class Cohere extends ProviderBase {
  readonly CHAT_COMPLETIONS_SUPPORTED_PARAMETERS: (keyof OpenAIChatCompletionsRequestBody)[] =
    [
      "messages",
      "model",
      "frequency_penalty",
      "max_tokens",
      "presence_penalty",
      "response_format",
      "seed",
      "stop",
      "stream",
      "temperature",
      "top_p",
      "tools",
    ];

  endpoint: CohereEndpoint;

  constructor({ apiKey }: { apiKey: keyof Env }) {
    super({ apiKey });
    this.endpoint = new CohereEndpoint(apiKey);
  }

  async fetch(
    pathname: string,
    init?: Parameters<typeof fetch>[1],
  ): ReturnType<typeof fetch> {
    if (pathname.startsWith("/compatibility/v1")) {
      const openaiCompatibleEndpoint = new CohereOpenAICompatibleEndpoint(
        this.endpoint,
      );
      return openaiCompatibleEndpoint.fetch(
        pathname.replace("/compatibility/v1", ""),
        init,
      );
    } else {
      return this.endpoint.fetch(pathname, init);
    }
  }

  chatCompletionsRequestData({
    body,
    headers = {},
  }: {
    body: string;
    headers: HeadersInit;
  }) {
    const openaiCompatibleEndpoint = new CohereOpenAICompatibleEndpoint(
      this.endpoint,
    );

    return openaiCompatibleEndpoint.requestData("/chat/completions", {
      method: "POST",
      headers,
      body: this.chatCompletionsRequestBody(body),
    });
  }

  async listModels() {
    const response = await this.fetchModels();
    const data = (await response.json()) as CohereModelsListResponseBody;

    return {
      object: "list",
      data: data.models.map(({ name, ...model }) => ({
        id: name,
        object: "model",
        created: 0,
        owned_by: "cohere",
        _: model,
      })),
    };
  }

  fetchModels() {
    return this.fetch("/v1/models?page_size=100&endpoint=chat", {
      method: "GET",
    });
  }
}
