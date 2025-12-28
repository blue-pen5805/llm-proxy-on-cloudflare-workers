import { Secrets } from "../../utils/secrets";
import { EndpointBase } from "../endpoint";

export class AnthropicEndpoint extends EndpointBase {
  apiKeyName: keyof Env;

  constructor(apiKeyName: keyof Env) {
    super();
    this.apiKeyName = apiKeyName;
  }

  available() {
    return Secrets.getAll(this.apiKeyName).length > 0;
  }

  baseUrl() {
    return `https://api.anthropic.com`;
  }

  async headers() {
    const apiKey = await Secrets.getAsync(this.apiKeyName);
    return {
      "Content-Type": "application/json",
      "x-api-key": `${apiKey}`,
      "anthropic-version": "2023-06-01",
    };
  }
}
