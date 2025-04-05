import { EndpointBase } from "../endpoint";

export class AnthropicEndpoint extends EndpointBase {
  apiKey: string;

  constructor(apikey: string) {
    super();
    this.apiKey = apikey;
  }

  available() {
    return Boolean(this.apiKey);
  }

  baseUrl() {
    return `https://api.anthropic.com`;
  }

  headers() {
    return {
      "Content-Type": "application/json",
      "x-api-key": `${this.apiKey}`,
      "anthropic-version": "2023-06-01",
    };
  }
}
