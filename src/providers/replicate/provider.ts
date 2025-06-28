import { Secrets } from "../../utils/secrets";
import { OpenAIModelsListResponseBody } from "../openai/types";
import { ProviderBase, ProviderNotSupportedError } from "../provider";
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

  buildChatCompletionsRequest({
    body,
    headers = {},
  }: {
    body: string;
    headers: HeadersInit;
  }): [string, RequestInit] {
    throw new ProviderNotSupportedError(
      "Replicate does not support chat completions",
    );
  }
  buildModelsRequest(): [string, RequestInit] {
    throw new ProviderNotSupportedError(
      "Replicate does not support list models",
    );
  }
}
