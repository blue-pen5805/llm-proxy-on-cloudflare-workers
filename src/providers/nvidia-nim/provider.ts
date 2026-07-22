import { defineProvider } from "../provider";

export const NvidiaNim = defineProvider({
  openAICompatible: true,
  apiKeyName: "NVIDIA_NIM_API_KEY",
  baseUrl: "https://integrate.api.nvidia.com",
  pathnamePrefix: "/v1",
});
