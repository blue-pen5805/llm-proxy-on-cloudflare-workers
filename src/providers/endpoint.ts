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
    const url = this.baseUrl() + this.pathnamePrefix() + pathname;

    return fetch2(url, this.requestData(init));
  }

  requestData(init?: RequestInit): Parameters<typeof fetch>[1] {
    return {
      ...init,
      headers: {
        ...init?.headers,
        ...this.headers(),
      },
    };
  }
}
