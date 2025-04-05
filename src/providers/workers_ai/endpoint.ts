import { EndpointBase } from "../endpoint";

export class WorkersAiEndpoint extends EndpointBase {
  apiKey: string;
  accountId: string;

  constructor(apikey: string, accountId: string) {
    super();
    this.apiKey = apikey;
    this.accountId = accountId;
  }

  available() {
    return Boolean(this.apiKey);
  }

  baseUrl() {
    return `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai`;
  }

  headers() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
  }
}
