import { OpenAIChatCompletionsRequestBody } from "../openai/types";
import { OpenAICompatibleProvider } from "../provider";

export class Cerebras extends OpenAICompatibleProvider {
  readonly apiKeyName: keyof Env = "CEREBRAS_API_KEY";
  readonly baseUrlProp: string = "https://api.cerebras.ai/v1";

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
}
