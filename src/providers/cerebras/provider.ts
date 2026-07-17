import { OpenAIChatCompletionsRequestBody } from "../openai/types";
import { defineProvider, type Provider } from "../provider";

export type Cerebras = Provider;

export const Cerebras = defineProvider({
  openAICompatible: true,
  apiKeyName: "CEREBRAS_API_KEY",
  baseUrl: "https://api.cerebras.ai/v1",
  // https://inference-docs.cerebras.ai/openai#currently-unsupported-openai-features
  chatCompletionSupportedParameters: [
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
});
