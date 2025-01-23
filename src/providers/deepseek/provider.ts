import { ProviderBase } from "../provider";
import { DeepSeekEndpoint } from "./endpoint";

export class DeepSeek extends ProviderBase {
  endpoint: DeepSeekEndpoint;

  constructor({ apiKey }: { apiKey: keyof Env }) {
    super({ apiKey });
    this.endpoint = new DeepSeekEndpoint(apiKey);
  }
}
