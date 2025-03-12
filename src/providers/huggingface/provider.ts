import { OpenAIModelsListResponseBody } from "../openai/types";
import { ProviderBase } from "../provider";
import { HuggingFaceEndpoint } from "./endpoint";

export class HuggingFace extends ProviderBase {
  readonly chatCompletionPath: string = "";
  readonly modelsPath: string = "";

  endpoint: HuggingFaceEndpoint;

  constructor({ apiKey }: { apiKey: keyof Env }) {
    super({ apiKey });
    this.endpoint = new HuggingFaceEndpoint(apiKey);
  }

  async chatCompletions({
    body,
    headers = {},
  }: {
    body: string;
    headers: HeadersInit;
  }): Promise<Response> {
    return Promise.resolve(new Response("Not Supported"));
  }

  async listModels(): Promise<OpenAIModelsListResponseBody> {
    return Promise.resolve({
      object: "list",
      data: [],
    });
  }
}
