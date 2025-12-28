import { Secrets } from "../../utils/secrets";
import { EndpointBase } from "../endpoint";

export class OpenAIEndpoint extends EndpointBase {
  apiKeyName: keyof Env;

  constructor(apiKeyName: keyof Env) {
    super();
    this.apiKeyName = apiKeyName;
  }

  available() {
    return Secrets.getAll(this.apiKeyName).length > 0;
  }

  baseUrl() {
    return "https://api.openai.com/v1";
  }

  async headers() {
    const apiKey = await Secrets.getAsync(this.apiKeyName);
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };
  }
}
