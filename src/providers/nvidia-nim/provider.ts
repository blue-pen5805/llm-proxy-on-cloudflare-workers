import { defineProvider, type Provider } from "../provider";

export type NvidiaNim = Provider;

export const NvidiaNim = defineProvider({
  openAICompatible: true,
  apiKeyName: "NVIDIA_NIM_API_KEY",
  baseUrl: "https://integrate.api.nvidia.com",
  pathnamePrefix: "/v1",
});
