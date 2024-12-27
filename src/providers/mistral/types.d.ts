// -- Models --
export type MistralModelsListResponseBody = {
  object: string;
  data: {
    id: string;
    object: string;
    created: number;
    owned_by: string;
    capabilities: {
      completion_chat: boolean;
      completion_fim: boolean;
      function_calling: boolean;
      fine_tuning: boolean;
      vision: boolean;
    };
    name: string;
    description: string;
    max_context_length: number;
    aliases: string[];
    deprecation: null;
    default_model_temperature: number | null;
    type: string;
  }[];
};
