import { Secrets } from "../../utils/secrets";
import { EndpointBase } from "../endpoint";

export class DeepSeekEndpoint extends EndpointBase {
  apiKey: keyof Env;

  constructor(apikey: keyof Env) {
    super();
    this.apiKey = apikey;
  }

  available() {
    return Boolean(Secrets.get(this.apiKey));
  }

  baseUrl() {
    return "https://api.deepseek.com";
  }

  headers() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Secrets.get(this.apiKey)}`,
    };
  }
}
