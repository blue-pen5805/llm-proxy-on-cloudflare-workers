import { fetch2 } from "../utils";

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

  fetch(
    pathname: string,
    init?: Parameters<typeof fetch>[1],
  ): ReturnType<typeof fetch> {
    return fetch2(...this.requestData(pathname, init));
  }

  requestData(pathname: string, init?: RequestInit): Parameters<typeof fetch> {
    const url = this.baseUrl() + this.pathnamePrefix() + pathname;

    return [
      url,
      {
        ...init,
        headers: {
          ...init?.headers,
          ...this.headers(),
        },
      },
    ];
  }
}
