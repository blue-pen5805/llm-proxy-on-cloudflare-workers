import { ProviderBase } from "../provider";
import { OpenAIEndpoint } from "./endpoint";

export class OpenAI extends ProviderBase {
  readonly apiKeyName: keyof Env = "OPENAI_API_KEY";

  constructor() {
    super();
    this.endpoint = new OpenAIEndpoint(this.apiKeyName);
  }
}
