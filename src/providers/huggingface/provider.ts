import { Secrets } from "../../utils/secrets";
import { OpenAIModelsListResponseBody } from "../openai/types";
import { ProviderBase } from "../provider";
import { HuggingFaceEndpoint } from "./endpoint";

export class HuggingFace extends ProviderBase {
  readonly chatCompletionPath: string = "";
  readonly modelsPath: string = "";

  readonly apiKeyName: keyof Env = "HUGGINGFACE_API_KEY";

  endpoint: HuggingFaceEndpoint;

  constructor() {
    super();
    this.endpoint = new HuggingFaceEndpoint(Secrets.get(this.apiKeyName));
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
