import { Secrets } from "../../utils/secrets";
import { EndpointBase } from "../endpoint";

export class WorkersAiEndpoint extends EndpointBase {
  apiKey: keyof Env;
  accountId: keyof Env;

  constructor(apikey: keyof Env, accountId: keyof Env) {
    super();
    this.apiKey = apikey;
    this.accountId = accountId;
  }

  available() {
    return Boolean(Secrets.get(this.apiKey));
  }

  baseUrl() {
    return `https://api.cloudflare.com/client/v4/accounts/${Secrets.get(
      this.accountId,
      false,
    )}/ai`;
  }

  headers() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Secrets.get(this.apiKey, false)}`,
    };
  }
}
