import { Secrets } from "../../secrets";
import { EndpointBase } from "../endpoint";

export class GoogleAiStudioEndpoint extends EndpointBase {
  apiKey: keyof Env;

  constructor(apikey: keyof Env) {
    super();
    this.apiKey = apikey;
  }

  available() {
    return Boolean(Secrets.get(this.apiKey));
  }

  baseUrl() {
    return "https://generativelanguage.googleapis.com";
  }

  headers() {
    return {
      "Content-Type": "application/json",
      "x-goog-api-key": Secrets.get(this.apiKey),
    };
  }
}

export class GoogleAiStudioOpenAICompatibleEndpoint extends EndpointBase {
  endpoint: GoogleAiStudioEndpoint;

  constructor(endpoint: GoogleAiStudioEndpoint) {
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
    return "/v1beta/openai";
  }

  headers() {
    const newHeaders = this.endpoint.headers() as Record<string, string>;
    delete newHeaders["x-goog-api-key"];

    return {
      ...newHeaders,
      Authorization: `Bearer ${this.endpoint.headers()["x-goog-api-key"]}`,
    };
  }
}