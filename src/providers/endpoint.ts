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

  async headers(): Promise<HeadersInit> {
    return {};
  }

  async fetch(pathname: string, init?: RequestInit): Promise<Response> {
    return fetch2(...(await this.buildRequest(pathname, init)));
  }

  async buildRequest(
    pathname: string,
    init?: RequestInit,
  ): Promise<[string, RequestInit]> {
    return [
      this.baseUrl() + this.pathnamePrefix() + pathname,
      await this.requestData(init),
    ];
  }

  async requestData(init?: RequestInit): Promise<RequestInit> {
    return {
      ...init,
      headers: {
        ...init?.headers,
        ...(await this.headers()),
      },
    };
  }
}
