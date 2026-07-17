import { Secrets } from "../../utils/secrets";
import { OpenAICompatibleProvider } from "../provider";

const REGION_PATTERN = /^[a-z]{2}(?:-gov)?-[a-z]+-\d$/;

export class AwsBedrock extends OpenAICompatibleProvider {
  readonly apiKeyName: keyof Env = "AWS_BEARER_TOKEN_BEDROCK";
  readonly regionName: keyof Env = "AWS_BEDROCK_REGION";
  readonly pathnamePrefixProp = "/v1";

  baseUrl(): string {
    return `https://bedrock-runtime.${this.region()}.amazonaws.com`;
  }

  aiGatewayPath(pathname: string): string {
    return `/bedrock-runtime/${encodeURIComponent(this.region())}/${pathname.replace(/^\/+/, "")}`;
  }

  private region(): string {
    const region = Secrets.get(this.regionName);
    if (!REGION_PATTERN.test(region)) {
      throw new Error("AWS_BEDROCK_REGION is missing or invalid.");
    }
    return region;
  }
}
