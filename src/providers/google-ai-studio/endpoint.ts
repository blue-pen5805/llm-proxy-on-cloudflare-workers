import { Secrets } from "../../utils/secrets";
import { EndpointBase } from "../endpoint";

export class GoogleAiStudioEndpoint extends EndpointBase {
  apiKeyName: keyof Env;

  constructor(apiKeyName: keyof Env) {
    super();
    this.apiKeyName = apiKeyName;
  }

  available() {
    return Secrets.getAll(this.apiKeyName).length > 0;
  }

  baseUrl() {
    return "https://generativelanguage.googleapis.com";
  }

  async headers() {
    const apiKey = await Secrets.getAsync(this.apiKeyName);
    return {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
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

  async headers() {
    const endpointHeaders = (await this.endpoint.headers()) as Record<
      string,
      string
    >;
    const apiKey = endpointHeaders["x-goog-api-key"];
    const { "x-goog-api-key": _, ...newHeaders } = endpointHeaders;

    return {
      ...newHeaders,
      Authorization: `Bearer ${apiKey}`,
    };
  }
}
