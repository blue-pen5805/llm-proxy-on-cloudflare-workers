import { Secrets } from "../../utils/secrets";
import { ProviderBase } from "../provider";
import { DeepSeekEndpoint } from "./endpoint";

export class DeepSeek extends ProviderBase {
  readonly apiKeyName: keyof Env = "DEEPSEEK_API_KEY";

  endpoint: DeepSeekEndpoint;

  constructor() {
    super();
    this.endpoint = new DeepSeekEndpoint(Secrets.get(this.apiKeyName));
  }
}
