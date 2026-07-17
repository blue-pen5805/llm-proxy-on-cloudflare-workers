import { Secrets } from "../../utils/secrets";
import { defineProvider, Provider, ProviderConstructor } from "../provider";

const REGION_PATTERN = /^[a-z]{2}(?:-gov)?-[a-z]+-\d$/;

export type AwsBedrock = Provider & { readonly regionName: keyof Env };

function region(provider: AwsBedrock): string {
  const value = Secrets.get(provider.regionName);
  if (!REGION_PATTERN.test(value)) {
    throw new Error("AWS_BEDROCK_REGION is missing or invalid.");
  }
  return value;
}

export const AwsBedrock = defineProvider({
  properties: { regionName: "AWS_BEDROCK_REGION" as keyof Env },
  openAICompatible: true,
  apiKeyName: "AWS_BEARER_TOKEN_BEDROCK",
  pathnamePrefix: "/v1",
  baseUrl() {
    return `https://bedrock-runtime.${region(this as AwsBedrock)}.amazonaws.com`;
  },
  aiGatewayPath(pathname: string): string {
    return `/bedrock-runtime/${encodeURIComponent(region(this as AwsBedrock))}/${pathname.replace(/^\/+/, "")}`;
  },
}) as ProviderConstructor<[], AwsBedrock>;
