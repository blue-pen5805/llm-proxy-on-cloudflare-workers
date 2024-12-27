// -- Models --
export type GroqModelsListResponseBody = {
  object: string;
  data: {
    id: string;
    object: string;
    created: number;
    owned_by: string;
    active: boolean;
    context_window: number;
    public_apps: null;
  }[];
};
