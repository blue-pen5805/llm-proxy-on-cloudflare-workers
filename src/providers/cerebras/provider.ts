import { OpenAIChatCompletionsRequestBody } from "../openai/types";
import { ProviderBase } from "../provider";
import { CerebrasEndpoint } from "./endpoint";

export class Cerebras extends ProviderBase {
  // https://inference-docs.cerebras.ai/openai#currently-unsupported-openai-features
  readonly CHAT_COMPLETIONS_SUPPORTED_PARAMETERS: (keyof OpenAIChatCompletionsRequestBody)[] =
    [
      "messages",
      "model",
      "store",
      "metadata",
      // "frequency_penalty",
      // "logit_bias",
      // "logprobs",
      "max_tokens",
      "max_completion_tokens",
      "n",
      "modalities",
      "prediction",
      "audio",
      // "presence_penalty",
      "response_format",
      "seed",
      // "service_tier",
      "stop",
      "stream",
      "stream_options",
      "suffix",
      "temperature",
      "top_p",
      "tools",
      "tool_choice",
      // "parallel_tool_calls",
      "user",
      "function_call",
      "functions",
    ];

  endpoint: CerebrasEndpoint;

  constructor({ apiKey }: { apiKey: keyof Env }) {
    super({ apiKey });
    this.endpoint = new CerebrasEndpoint(apiKey);
  }
}
