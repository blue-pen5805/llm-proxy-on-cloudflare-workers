export const BUILT_IN_PROVIDER_NAMES = [
  "workers-ai",
  "aws-bedrock",
  "anthropic",
  "azure-openai",
  "cerebras",
  "cohere",
  "deepseek",
  "google-ai-studio",
  "google-vertex-ai",
  "grok",
  "groq",
  "huggingface",
  "mistral",
  "nvidia-nim",
  "openai",
  "openrouter",
  "perplexity-ai",
  "replicate",
  "ollama",
  "cline",
] as const;

export const BUILT_IN_PROVIDER_NAME_SET: ReadonlySet<string> = new Set(
  BUILT_IN_PROVIDER_NAMES,
);
