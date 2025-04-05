import { EndpointBase } from "../endpoint";

export class GrokEndpoint extends EndpointBase {
  apiKey: string;

  constructor(apikey: string) {
    super();
    this.apiKey = apikey;
  }

  available() {
    return Boolean(this.apiKey);
  }

  baseUrl() {
    return "https://api.x.ai";
  }

  headers() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
  }
}
