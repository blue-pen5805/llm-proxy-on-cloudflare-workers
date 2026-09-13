import { Secrets } from "../../utils/secrets";
import { defineProvider } from "../provider";

export const Replicate = defineProvider({
  endpoints: {},

  apiKeyName: "REPLICATE_API_KEY",
  baseUrl: "https://api.replicate.com/v1",
  async headers(apiKeyIndex): Promise<HeadersInit> {
    const apiKey = Secrets.get(
      "REPLICATE_API_KEY",
      apiKeyIndex,
      this.credentialProfile,
    );
    return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  },
});
