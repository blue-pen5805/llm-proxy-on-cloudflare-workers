// https://docs.anthropic.com/en/api/models-list
export type AnthropicModelsListResponseBody = {
  data: {
    type: string;
    id: string;
    display_name: string;
    created_at: string;
  }[];
  has_more: boolean;
  first_id: string;
  last_id: string;
};
