import { Secrets } from "../../utils/secrets";
import { EndpointBase } from "../endpoint";

export class WorkersAiEndpoint extends EndpointBase {
  apiKeyName: keyof Env;
  accountIdName: keyof Env;

  constructor(apiKeyName: keyof Env, accountIdName: keyof Env) {
    super();
    this.apiKeyName = apiKeyName;
    this.accountIdName = accountIdName;
  }

  available() {
    return (
      Secrets.getAll(this.apiKeyName).length > 0 &&
      Secrets.getAll(this.accountIdName).length > 0
    );
  }

  baseUrl() {
    const accountId = Secrets.get(this.accountIdName, 0);
    return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai`;
  }

  async headers(apiKeyIndex?: number) {
    const apiKey = Secrets.get(this.apiKeyName, apiKeyIndex);
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };
  }
}
