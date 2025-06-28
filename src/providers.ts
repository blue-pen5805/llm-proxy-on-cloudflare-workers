import { Anthropic } from "./providers/anthropic";
import { Cerebras } from "./providers/cerebras";
import { Cohere } from "./providers/cohere";
import { DeepSeek } from "./providers/deepseek";
import { GoogleAiStudio } from "./providers/google_ai_studio";
import { Grok } from "./providers/grok";
import { Groq } from "./providers/groq";
import { HuggingFace } from "./providers/huggingface";
import { Mistral } from "./providers/mistral";
import { OpenAI } from "./providers/openai";
import { OpenRouter } from "./providers/openrouter";
import { PerplexityAi } from "./providers/perplexity-ai";
import { ProviderBase } from "./providers/provider";
import { Replicate } from "./providers/replicate";
import { WorkersAi } from "./providers/workers_ai";

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
  // "cartesia": {},
  cerebras: {
    providerClass: Cerebras,
  },
  cohere: {
    providerClass: Cohere,
  },
  deepseek: {
    providerClass: DeepSeek,
  },
  // elevenlabs: {},
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
  "perplexity-ai": {
    providerClass: PerplexityAi,
  },
  replicate: {
    providerClass: Replicate,
  },
  // --- Other Providers
};
