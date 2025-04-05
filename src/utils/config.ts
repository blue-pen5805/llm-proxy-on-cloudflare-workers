import { Environments } from "./environments";

export class Config {
  static apiKeys(): string[] | undefined {
    const apiKeys = Environments.get("PROXY_API_KEY");

    if (apiKeys === undefined) {
      return undefined;
    }

    if (Array.isArray(apiKeys)) {
      return apiKeys;
    }
    if (typeof apiKeys === "string") {
      return [apiKeys];
    }

    return undefined;
  }
}
