import { Secrets } from "../../utils/secrets";
import { EndpointBase } from "../endpoint";

export class AnthropicEndpoint extends EndpointBase {
  apiKey: keyof Env;

  constructor(apikey: keyof Env) {
    super();
    this.apiKey = apikey;
  }

  available() {
    return Boolean(Secrets.get(this.apiKey));
  }

  baseUrl() {
    return `https://api.anthropic.com`;
  }

  headers() {
    return {
      "Content-Type": "application/json",
      "x-api-key": `${Secrets.get(this.apiKey)}`,
      "anthropic-version": "2023-06-01",
    };
  }
}
