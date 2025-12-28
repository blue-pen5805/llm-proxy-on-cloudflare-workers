import { Secrets } from "../../utils/secrets";
import { EndpointBase } from "../endpoint";

export class PerplexityAiEndpoint extends EndpointBase {
  apiKeyName: keyof Env;

  constructor(apiKeyName: keyof Env) {
    super();
    this.apiKeyName = apiKeyName;
  }

  available() {
    return Secrets.getAll(this.apiKeyName).length > 0;
  }

  baseUrl() {
    return "https://api.perplexity.ai";
  }

  async headers(apiKeyIndex?: number) {
    const apiKey = Secrets.get(this.apiKeyName, apiKeyIndex);
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    };
  }
}
