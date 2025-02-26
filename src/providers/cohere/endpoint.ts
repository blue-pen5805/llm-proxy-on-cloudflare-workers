import { Secrets } from "../../secrets";
import { EndpointBase } from "../endpoint";

export class CohereEndpoint extends EndpointBase {
  apiKey: keyof Env;

  constructor(apikey: keyof Env) {
    super();
    this.apiKey = apikey;
  }

  available() {
    return Boolean(Secrets.get(this.apiKey));
  }

  baseUrl() {
    return `https://api.cohere.com`;
  }

  headers() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Secrets.get(this.apiKey)}`,
    };
  }
}

export class CohereOpenAICompatibleEndpoint extends EndpointBase {
  endpoint: CohereEndpoint;

  constructor(endpoint: CohereEndpoint) {
    super();
    this.endpoint = endpoint;
  }

  available() {
    return this.endpoint.available();
  }

  baseUrl() {
    return this.endpoint.baseUrl();
  }

  pathnamePrefix() {
    return "/compatibility/v1";
  }

  headers() {
    return this.endpoint.headers();
  }
}
