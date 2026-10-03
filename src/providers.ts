import { Anthropic } from "./providers/anthropic";
import { AwsBedrock } from "./providers/aws-bedrock";
import { AzureOpenAI } from "./providers/azure-openai";
import { Cerebras } from "./providers/cerebras";
import { Cline } from "./providers/cline";
import { Cohere } from "./providers/cohere";
import { DeepSeek } from "./providers/deepseek";
import { GoogleAiStudio } from "./providers/google-ai-studio";
import { GoogleVertexAi } from "./providers/google-vertex-ai";
import { Grok } from "./providers/grok";
import { Groq } from "./providers/groq";
import { HuggingFace } from "./providers/huggingface";
import { Mistral } from "./providers/mistral";
import { NvidiaNim } from "./providers/nvidia-nim";
import { Ollama } from "./providers/ollama";
import { OpenAI } from "./providers/openai";
import { OpenCodeGo, OpenCodeZen } from "./providers/opencode";
import { OpenRouter } from "./providers/openrouter";
import { PerplexityAi } from "./providers/perplexity-ai";
import { ProviderBase } from "./providers/provider";
import { ProviderRegistry } from "./providers/registry";
import { Replicate } from "./providers/replicate";
import { WorkersAi } from "./providers/workers_ai";
import { Config } from "./utils/config";

export { ProviderRegistry } from "./providers/registry";

export const BUILT_IN_PROVIDER_CONSTRUCTORS: {
  [providerName: string]: typeof ProviderBase;
} = {
  // --- Cloudflare AI Gateway supported providers
  "workers-ai": WorkersAi,
  "aws-bedrock": AwsBedrock,
  anthropic: Anthropic,
  "azure-openai": AzureOpenAI,
  cerebras: Cerebras,
  cohere: Cohere,
  deepseek: DeepSeek,
  "google-ai-studio": GoogleAiStudio,
  "google-vertex-ai": GoogleVertexAi,
  grok: Grok,
  groq: Groq,
  huggingface: HuggingFace,
  mistral: Mistral,
  "nvidia-nim": NvidiaNim,
  openai: OpenAI,
  openrouter: OpenRouter,
  "perplexity-ai": PerplexityAi,
  replicate: Replicate,
  ollama: Ollama,
  // --- Other providers
  cline: Cline,
  "opencode-zen": OpenCodeZen,
  "opencode-go": OpenCodeGo,
};

export function getProviderByName(
  providerName: string,
  env: Env,
): ProviderBase | undefined {
  return createProviderRegistry(env).get(providerName);
}

export function getAllProviderInstances(
  env: Env,
): Record<string, ProviderBase> {
  return createProviderRegistry(env).all();
}

// Registries hold no request state (providers read the environment through the
// request-scoped AsyncLocalStorage on every call), so one registry per custom
// endpoint configuration is shared across requests. Config.customOpenAIEndpoints
// memoizes its validated result, keeping the cache key identity stable.
const customEndpointRegistryCache = new WeakMap<object, ProviderRegistry>();
let builtInOnlyRegistry: ProviderRegistry | undefined;

export function createProviderRegistry(_environment: Env): ProviderRegistry {
  const customEndpoints = Config.customOpenAIEndpoints();
  if (!customEndpoints) {
    return (builtInOnlyRegistry ??= new ProviderRegistry(
      BUILT_IN_PROVIDER_CONSTRUCTORS,
    ));
  }

  let registry = customEndpointRegistryCache.get(customEndpoints);
  if (!registry) {
    registry = new ProviderRegistry(
      BUILT_IN_PROVIDER_CONSTRUCTORS,
      customEndpoints,
    );
    customEndpointRegistryCache.set(customEndpoints, registry);
  }
  return registry;
}
