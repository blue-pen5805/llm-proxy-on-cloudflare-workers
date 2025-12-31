import { Anthropic } from "./providers/anthropic";
import { Cerebras } from "./providers/cerebras";
import { Cohere } from "./providers/cohere";
import { CustomOpenAI } from "./providers/custom-openai";
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
import { Replicate } from "./providers/replicate";
import { WorkersAi } from "./providers/workers_ai";
import { Config } from "./utils/config";

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
  _env: Env,
): ProviderBase | undefined {
  const ProviderClass = Providers[providerName];
  if (ProviderClass) {
    return new ProviderClass();
  }

  // Check for custom endpoints
  const customEndpoints = Config.customOpenAIEndpoints();
  const customConfig = customEndpoints?.find((e) => e.name === providerName);
  if (customConfig) {
    return new CustomOpenAI(customConfig);
  }

  return undefined;
}

export function getAllProviders(env: Env): Record<string, ProviderBase> {
  const providers = Object.fromEntries(
    Object.keys(Providers).map((providerName) => [
      providerName,
      getProvider(providerName, env)!,
    ]),
  );

  // Add custom endpoints
  const customEndpoints = Config.customOpenAIEndpoints();
  if (customEndpoints) {
    for (const config of customEndpoints) {
      providers[config.name] = new CustomOpenAI(config);
    }
  }

  return providers;
}
