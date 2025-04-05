import { Secrets } from "../../utils/secrets";
import { ProviderBase } from "../provider";
import { GrokEndpoint } from "./endpoint";

export class Grok extends ProviderBase {
  readonly chatCompletionPath: string = "/v1/chat/completions";
  readonly modelsPath: string = "/v1/models";

  readonly apiKeyName: keyof Env = "GROK_API_KEY";

  endpoint: GrokEndpoint;

  constructor() {
    super();
    this.endpoint = new GrokEndpoint(Secrets.get(this.apiKeyName));
  }
}
