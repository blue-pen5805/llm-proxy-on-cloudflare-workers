import { ProviderBase } from "../provider";
import { GrokEndpoint } from "./endpoint";

export class Grok extends ProviderBase {
  readonly chatCompletionPath: string = "/v1/chat/completions";
  readonly modelsPath: string = "/v1/models";

  endpoint: GrokEndpoint;

  constructor({ apiKey }: { apiKey: keyof Env }) {
    super({ apiKey });
    this.endpoint = new GrokEndpoint(apiKey);
  }
}
