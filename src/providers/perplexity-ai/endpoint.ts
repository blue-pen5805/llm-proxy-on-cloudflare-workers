import { EndpointBase } from "../endpoint";

export class PerplexityAiEndpoint extends EndpointBase {
  apiKey: string;

  constructor(apikey: string) {
    super();
    this.apiKey = apikey;
  }

  available() {
    return Boolean(this.apiKey);
  }

  baseUrl() {
    return "https://api.perplexity.ai";
  }

  headers() {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
  }
}
