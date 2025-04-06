import { EndpointBase } from "../endpoint";

export class ReplicateEndpoint extends EndpointBase {
  apiKey: string;

  constructor(apikey: string) {
    super();
    this.apiKey = apikey;
  }

  available() {
    return Boolean(this.apiKey);
  }

  baseUrl() {
    return "https://api.replicate.com/v1";
  }

  headers() {
    return {
      "Content-Type": "application/json",
      Authorization: `Token ${this.apiKey}`,
    };
  }
}
