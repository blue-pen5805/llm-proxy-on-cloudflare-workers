import { Anthropic } from "./providers/anthropic";
import { Cerebras } from "./providers/cerebras";
import { Cohere } from "./providers/cohere";
import { DeepSeek } from "./providers/deepseek";
import { GoogleAiStudio } from "./providers/google-ai-studio";
import { Grok } from "./providers/grok";
import { Groq } from "./providers/groq";
import { HuggingFace } from "./providers/huggingface";
import { Mistral } from "./providers/mistral";
import { Ollama } from "./providers/ollama";
import { OpenAI } from "./providers/openai";
import { OpenRouter } from "./providers/openrouter";
import { PerplexityAi } from "./providers/perplexity-ai";
import { ProviderBase } from "./providers/provider";
import { ProviderRegistry } from "./providers/registry";
import { Replicate } from "./providers/replicate";
import { WorkersAi } from "./providers/workers_ai";
import { Config } from "./utils/config";

export { ProviderRegistry } from "./providers/registry";

export const Providers: {
  [providerName: string]: typeof ProviderBase;
} = {
  // --- Cloudflare AI Gateway Supported Providers
  "workers-ai": WorkersAi,
  // "aws-bedrock": {},
  anthropic: Anthropic,
  // "azure-openai": {},
  // "cartesia": {},
  cerebras: Cerebras,
  cohere: Cohere,
  deepseek: DeepSeek,
  // elevenlabs: {},
  "google-ai-studio": GoogleAiStudio,
  // "google-vertex-ai": {},
  grok: Grok,
  groq: Groq,
  huggingface: HuggingFace,
  mistral: Mistral,
  openai: OpenAI,
  openrouter: OpenRouter,
  "perplexity-ai": PerplexityAi,
  replicate: Replicate,
  ollama: Ollama,
  // --- Other Providers
};

export function getProvider(
  providerName: string,
  env: Env,
): ProviderBase | undefined {
  return createProviderRegistry(env).get(providerName);
}

export function getAllProviders(env: Env): Record<string, ProviderBase> {
  return createProviderRegistry(env).all();
}

export function createProviderRegistry(_env: Env): ProviderRegistry {
  return new ProviderRegistry(Providers, Config.customOpenAIEndpoints() ?? []);
}
