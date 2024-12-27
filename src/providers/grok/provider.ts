import { ProviderBase } from "../provider";
import { GrokEndpoint } from "./endpoint";

export class Grok extends ProviderBase {
  endpoint: GrokEndpoint;

  constructor({ apiKey }: { apiKey: keyof Env }) {
    super({ apiKey });
    this.endpoint = new GrokEndpoint(apiKey);
  }

  // OpenAI Comaptible API - Chat Completions
  chatCompletionsRequestData({
    body,
    headers,
  }: {
    body: string;
    headers: HeadersInit;
  }) {
    return this.endpoint.requestData("/v1/chat/completions", {
      method: "POST",
      headers,
      body,
    });
  }
}
