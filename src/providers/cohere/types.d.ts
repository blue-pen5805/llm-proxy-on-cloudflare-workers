// https://docs.cohere.com/reference/list-models
export type CohereModelsListResponseBody = {
  models: {
    name: string;
    endpoints?: string[];
    finetuned?: boolean;
    context_length?: number;
    tokenizer_url?: string;
    default_endpoints?: string[];
  }[];
  next_page_token?: string;
};
