import { EndpointBase } from "../endpoint";

export class DeepSeekEndpoint extends EndpointBase {
  apiKey: string;

  constructor(apikey: string) {
    super();
    this.apiKey = apikey;
  }

  available() {
    return Boolean(this.apiKey);
  }

  baseUrl() {
    return "https://api.deepseek.com";
  }

  headers() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
  }
}
