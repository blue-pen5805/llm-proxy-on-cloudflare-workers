import { Secrets } from "../../utils/secrets";
import { ProviderBase } from "../provider";
import { OpenAIEndpoint } from "./endpoint";

export class OpenAI extends ProviderBase {
  readonly apiKeyName: keyof Env = "OPENAI_API_KEY";

  endpoint: OpenAIEndpoint;

  constructor() {
    super();
    this.endpoint = new OpenAIEndpoint(Secrets.get(this.apiKeyName));
  }
}
