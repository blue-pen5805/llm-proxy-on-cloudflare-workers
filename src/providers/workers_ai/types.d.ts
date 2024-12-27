// -- Models --
export type WorkersAiModelsListResponseBody = {
  success: boolean;
  result: {
    id: string;
    source: number;
    name: string;
    description: string;
    task: {
      id: string;
      name: string;
      description: string;
    };
    tags: string[];
    propertis: {
      property_id: string;
      value: string;
    }[];
  }[];
  errors: any[];
  messages: any[];
  result_info: {
    count: number;
    page: number;
    per_page: number;
    total_count: number;
  };
};
