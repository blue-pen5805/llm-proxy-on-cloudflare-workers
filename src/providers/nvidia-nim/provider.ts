import { chatCompletionsEndpoint } from "../inference";
import { defineProvider } from "../provider";

export const NvidiaNim = defineProvider({
  endpoints: {
    chat_completions: chatCompletionsEndpoint(),

    models: { path: "/models" },
  },

  openAICompatible: true,
  apiKeyName: "NVIDIA_NIM_API_KEY",
  baseUrl: "https://integrate.api.nvidia.com",
  pathnamePrefix: "/v1",
});
