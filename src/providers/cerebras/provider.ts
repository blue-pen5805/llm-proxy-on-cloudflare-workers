import { chatCompletionsEndpoint } from "../inference";
import { OpenAIChatCompletionsRequestBody } from "../openai/types";
import { defineProvider } from "../provider";

export const Cerebras = defineProvider({
  endpoints: {
    chat_completions: chatCompletionsEndpoint(undefined, {
      supportedParameters: [
        "messages",
        "model",
        "store",
        "metadata",
        "max_tokens",
        "max_completion_tokens",
        "n",
        "modalities",
        "prediction",
        "audio",
        "response_format",
        "seed",
        "stop",
        "stream",
        "stream_options",
        "suffix",
        "temperature",
        "top_p",
        "tools",
        "tool_choice",
        "user",
        "function_call",
        "functions",
      ] satisfies (keyof OpenAIChatCompletionsRequestBody)[],
    }),

    models: { path: "/models" },
  },

  openAICompatible: true,
  apiKeyName: "CEREBRAS_API_KEY",
  baseUrl: "https://api.cerebras.ai/v1",
  // https://inference-docs.cerebras.ai/openai#currently-unsupported-openai-features
});
