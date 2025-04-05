import { EndpointBase } from "../endpoint";

export class CerebrasEndpoint extends EndpointBase {
  apiKey: string;

  constructor(apikey: string) {
    super();
    this.apiKey = apikey;
  }

  available() {
    return Boolean(this.apiKey);
  }

  baseUrl() {
    return "https://api.cerebras.ai/v1";
  }

  headers() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
  }
}
