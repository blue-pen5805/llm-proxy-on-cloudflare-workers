import { ProviderBase } from "./providers/provider";
import { Anthropic } from "./providers/anthropic";
import { Cohere } from "./providers/cohere";
import { DeepSeek } from "./providers/deepseek";
import { GoogleAiStudio } from "./providers/google_ai_studio";
import { Grok } from "./providers/grok";
import { Groq } from "./providers/groq";
import { Mistral } from "./providers/mistral";
import { OpenAI } from "./providers/openai";
import { WorkersAi } from "./providers/workers_ai";
import { OpenRouter } from "./providers/openrouter";
import { HuggingFace } from "./providers/huggingface";
import { Cerebras } from "./providers/cerebras";

export const Providers: {
  [providerName: string]: {
    providerClass: typeof ProviderBase;
  };
} = {
  // --- Cloudflare AI Gateway Supported Providers
  "workers-ai": {
    providerClass: WorkersAi,
  },
  // "aws-bedrock": {},
  anthropic: {
    providerClass: Anthropic,
  },
  // "azure-openai": {},
  cerebras: {
    providerClass: Cerebras,
  },
  cohere: {
    providerClass: Cohere,
  },
  deepseek: {
    providerClass: DeepSeek,
  },
  "google-ai-studio": {
    providerClass: GoogleAiStudio,
  },
  // "google-vertex-ai": {},
  grok: {
    providerClass: Grok,
  },
  groq: {
    providerClass: Groq,
  },
  huggingface: {
    providerClass: HuggingFace,
  },
  mistral: {
    providerClass: Mistral,
  },
  openai: {
    providerClass: OpenAI,
  },
  openrouter: {
    providerClass: OpenRouter,
  },
  // "perplexity-ai": {},
  // "replicate": {},
  // --- Other Providers
};
