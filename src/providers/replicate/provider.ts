import { defineProvider } from "../provider";

export const Replicate = defineProvider({
  endpoints: {},

  apiKeyName: "REPLICATE_API_KEY",
  baseUrl: "https://api.replicate.com/v1",
});
