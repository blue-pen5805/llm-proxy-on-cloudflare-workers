import { ProviderBase } from "../provider";
import { OpenAIEndpoint } from "./endpoint";

export class OpenAI extends ProviderBase {
  endpoint: OpenAIEndpoint;

  constructor({ apiKey }: { apiKey: keyof Env }) {
    super({ apiKey });
    this.endpoint = new OpenAIEndpoint(apiKey);
  }
}
