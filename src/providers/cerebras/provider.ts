import { OpenAIChatCompletionsRequestBody } from "../openai/types";
import { ProviderBase } from "../provider";
import { CerebrasEndpoint } from "./endpoint";

export class Cerebras extends ProviderBase {
  readonly apiKeyName: keyof Env = "CEREBRAS_API_KEY";

  // https://inference-docs.cerebras.ai/openai#currently-unsupported-openai-features
  readonly CHAT_COMPLETIONS_SUPPORTED_PARAMETERS: (keyof OpenAIChatCompletionsRequestBody)[] =
    [
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
    ];

  endpoint: CerebrasEndpoint;

  constructor() {
    super();
    this.endpoint = new CerebrasEndpoint(this.apiKeyName);
  }
}
