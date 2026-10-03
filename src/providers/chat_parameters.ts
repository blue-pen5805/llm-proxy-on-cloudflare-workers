import type { OpenAIChatCompletionsRequestBody } from "./openai/types";

export const DEFAULT_CHAT_COMPLETIONS_SUPPORTED_PARAMETERS: (keyof OpenAIChatCompletionsRequestBody)[] =
  [
    "messages",
    "model",
    "store",
    "metadata",
    "frequency_penalty",
    "logit_bias",
    "logprobs",
    "top_logprobs",
    "max_tokens",
    "max_completion_tokens",
    "reasoning_effort",
    "n",
    "modalities",
    "moderation",
    "prediction",
    "audio",
    "presence_penalty",
    "prompt_cache_key",
    "prompt_cache_options",
    "prompt_cache_retention",
    "response_format",
    "safety_identifier",
    "seed",
    "service_tier",
    "stop",
    "stream",
    "stream_options",
    "temperature",
    "top_p",
    "tools",
    "tool_choice",
    "parallel_tool_calls",
    "user",
    "verbosity",
    "web_search_options",
    "function_call",
    "functions",
  ];

const KNOWN_CHAT_COMPLETIONS_PARAMETERS = new Set<
  keyof OpenAIChatCompletionsRequestBody
>([...DEFAULT_CHAT_COMPLETIONS_SUPPORTED_PARAMETERS, "suffix"]);

const DEFAULT_SUPPORTED_PARAMETERS = new Set(
  DEFAULT_CHAT_COMPLETIONS_SUPPORTED_PARAMETERS,
);

function filterParameters(
  data: Readonly<Record<string, unknown>>,
  supported: ReadonlySet<keyof OpenAIChatCompletionsRequestBody>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key in data) {
    const parameter = key as keyof OpenAIChatCompletionsRequestBody;
    if (
      Object.prototype.hasOwnProperty.call(data, key) &&
      (!KNOWN_CHAT_COMPLETIONS_PARAMETERS.has(parameter) ||
        supported.has(parameter))
    ) {
      result[key] = data[key];
    }
  }
  return result;
}

const defaultFilter = (data: Readonly<Record<string, unknown>>) =>
  filterParameters(data, DEFAULT_SUPPORTED_PARAMETERS);

export function chatParameterFilter(
  parameters?: readonly (keyof OpenAIChatCompletionsRequestBody)[],
) {
  if (!parameters) return defaultFilter;
  const supported = new Set(parameters);
  return (data: Readonly<Record<string, unknown>>) =>
    filterParameters(data, supported);
}
