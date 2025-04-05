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

  static aiGateway(): {
    accountId: string | undefined;
    name: string | undefined;
    token: string | undefined;
  } {
    return {
      accountId: Environments.get("CLOUDFLARE_ACCOUNT_ID", false),
      name: Environments.get("AI_GATEWAY_NAME", false),
      token: Environments.get("CF_AIG_TOKEN", false),
    };
  }
}
