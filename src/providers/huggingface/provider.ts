import { Secrets } from "../../utils/secrets";
import { OpenAIModelsListResponseBody } from "../openai/types";
import { ProviderBase, ProviderNotSupportedError } from "../provider";
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

  buildChatCompletionsRequest({
    body,
    headers = {},
  }: {
    body: string;
    headers: HeadersInit;
  }): [string, RequestInit] {
    throw new ProviderNotSupportedError(
      "HuggingFace does not support chat completions",
    );
  }

  buildModelsRequest(): [string, RequestInit] {
    throw new ProviderNotSupportedError(
      "HuggingFace does not support list models",
    );
  }
}
