// -- Models --
export type OpenRouterModelsListResponseBody = {
  object: string;
  data: {
    id: string;
    name: string;
    created: number;
    description: string;
    context_length: number;
    architecture: {
      tokenizer: string;
      instruct_type: string;
      modality: string;
    };
    pricing: {
      prompt: string;
      completion: string;
      request: string;
      image: string;
    };
    top_provider: {
      context_length: number;
      max_completion_tokens: number | null;
      is_moderated: boolean;
    };
    per_request_limits: {
      prompt_tokens: number | null;
      completion_tokens: number | null;
    } | null;
  }[];
};
