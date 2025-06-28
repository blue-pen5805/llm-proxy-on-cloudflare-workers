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

  headers(): HeadersInit {
    return {};
  }

  fetch(pathname: string, init?: RequestInit): Promise<Response> {
    return fetch2(...this.buildRequest(pathname, init));
  }

  buildRequest(pathname: string, init?: RequestInit): [string, RequestInit] {
    return [
      this.baseUrl() + this.pathnamePrefix() + pathname,
      this.requestData(init),
    ];
  }

  requestData(init?: RequestInit): RequestInit {
    return {
      ...init,
      headers: {
        ...init?.headers,
        ...this.headers(),
      },
    };
  }
}
