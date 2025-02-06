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
    args: { apiKey: keyof Env; [key: string]: keyof Env };
  };
} = {
  // --- Cloudflare AI Gateway Supported Providers
  "workers-ai": {
    providerClass: WorkersAi,
    args: {
      apiKey: "CLOUDFLARE_API_KEY",
      accountId: "CLOUDFLARE_ACCOUNT_ID",
    },
  },
  // "aws-bedrock": {},
  anthropic: {
    providerClass: Anthropic,
    args: {
      apiKey: "ANTHROPIC_API_KEY",
    },
  },
  // "azure-openai": {},
  cerebras: {
    providerClass: Cerebras,
    args: {
      apiKey: "CEREBRAS_API_KEY",
    },
  },
  cohere: {
    providerClass: Cohere,
    args: {
      apiKey: "COHERE_API_KEY",
    },
  },
  deepseek: {
    providerClass: DeepSeek,
    args: {
      apiKey: "DEEPSEEK_API_KEY",
    },
  },
  "google-ai-studio": {
    providerClass: GoogleAiStudio,
    args: {
      apiKey: "GEMINI_API_KEY",
    },
  },
  // "google-vertex-ai": {},
  grok: {
    providerClass: Grok,
    args: {
      apiKey: "GROK_API_KEY",
    },
  },
  groq: {
    providerClass: Groq,
    args: {
      apiKey: "GROQ_API_KEY",
    },
  },
  huggingface: {
    providerClass: HuggingFace,
    args: {
      apiKey: "HUGGINGFACE_API_KEY",
    },
  },
  mistral: {
    providerClass: Mistral,
    args: {
      apiKey: "MISTRAL_API_KEY",
    },
  },
  openai: {
    providerClass: OpenAI,
    args: {
      apiKey: "OPENAI_API_KEY",
    },
  },
  openrouter: {
    providerClass: OpenRouter,
    args: {
      apiKey: "OPENROUTER_API_KEY",
    },
  },
  // "perplexity-ai": {},
  // "replicate": {},
  // --- Other Providers
};
