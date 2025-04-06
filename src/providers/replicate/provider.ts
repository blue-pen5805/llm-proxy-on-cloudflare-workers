import { Secrets } from "../../utils/secrets";
import { OpenAIModelsListResponseBody } from "../openai/types";
import { ProviderBase } from "../provider";
import { ReplicateEndpoint } from "./endpoint";

export class Replicate extends ProviderBase {
  readonly chatCompletionPath: string = "";
  readonly modelsPath: string = "";

  readonly apiKeyName: keyof Env = "REPLICATE_API_KEY";

  endpoint: ReplicateEndpoint;

  constructor() {
    super();
    this.endpoint = new ReplicateEndpoint(Secrets.get(this.apiKeyName));
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
