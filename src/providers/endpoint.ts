import { fetch2 } from "../utils/helpers";

export class EndpointBase {
  available(): boolean {
    return false;
  }

  baseUrl(): string {
    return "https://example.com";
  }

  pathnamePrefix(): string {
    return "";
  }

  async headers(_apiKeyIndex?: number): Promise<HeadersInit> {
    return {};
  }

  async fetch(
    pathname: string,
    init?: RequestInit,
    apiKeyIndex?: number,
  ): Promise<Response> {
    return fetch2(...(await this.buildRequest(pathname, init, apiKeyIndex)));
  }

  async buildRequest(
    pathname: string,
    init?: RequestInit,
    apiKeyIndex?: number,
  ): Promise<[string, RequestInit]> {
    return [
      this.baseUrl() + this.pathnamePrefix() + pathname,
      await this.requestData(init, apiKeyIndex),
    ];
  }

  async requestData(
    init?: RequestInit,
    apiKeyIndex?: number,
  ): Promise<RequestInit> {
    return {
      ...init,
      headers: {
        ...init?.headers,
        ...(await this.headers(apiKeyIndex)),
      },
    };
  }
}
