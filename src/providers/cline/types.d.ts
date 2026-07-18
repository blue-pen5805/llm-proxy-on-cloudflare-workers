export interface ClineRecommendedModel {
  id: string;
  name: string;
  description: string;
  tags: string[];
}

export interface ClineRecommendedModelsResponseBody {
  recommended?: ClineRecommendedModel[];
  free?: ClineRecommendedModel[];
  clinePass?: ClineRecommendedModel[];
}
