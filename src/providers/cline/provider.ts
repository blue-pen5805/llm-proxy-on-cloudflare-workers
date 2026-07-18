import { readResponseJson } from "../../utils/helpers";
import { OpenAIModelsListResponseBody } from "../openai/types";
import { defineProvider, type Provider } from "../provider";
import {
  ClineRecommendedModel,
  ClineRecommendedModelsResponseBody,
} from "./types";

export type Cline = Provider;

type ClineModelCategory = keyof ClineRecommendedModelsResponseBody;

const MODEL_CATEGORIES: readonly ClineModelCategory[] = [
  "recommended",
  "free",
  "clinePass",
];

function isWrappedChatCompletion(
  value: unknown,
): value is { data: Record<string, unknown>; success: true } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { success?: unknown }).success === true &&
    typeof (value as { data?: unknown }).data === "object" &&
    (value as { data?: unknown }).data !== null &&
    !Array.isArray((value as { data?: unknown }).data)
  );
}

function headersForTransformedBody(source: Headers): Headers {
  const headers = new Headers(source);
  for (const staleHeader of [
    "content-encoding",
    "content-length",
    "content-md5",
    "digest",
    "etag",
  ]) {
    headers.delete(staleHeader);
  }
  return headers;
}

export const Cline = defineProvider({
  openAICompatible: true,
  apiKeyName: "CLINE_API_KEY",
  baseUrl: "https://api.cline.bot/api/v1",
  modelsPath: "/ai/cline/recommended-models",

  async transformChatCompletionsResponse(response): Promise<Response> {
    if (
      !response.ok ||
      !response.headers.get("content-type")?.includes("application/json")
    ) {
      return response;
    }

    let body: unknown;
    try {
      body = await readResponseJson(response.clone());
    } catch {
      return response;
    }
    if (!isWrappedChatCompletion(body)) return response;

    return new Response(JSON.stringify(body.data), {
      status: response.status,
      statusText: response.statusText,
      headers: headersForTransformedBody(response.headers),
    });
  },

  convertModelsToOpenAIFormat(data): OpenAIModelsListResponseBody {
    const providerResponse = data as ClineRecommendedModelsResponseBody;
    return {
      object: "list",
      data: MODEL_CATEGORIES.flatMap((category) =>
        (providerResponse[category] ?? []).map(
          ({ id, name, description, tags }: ClineRecommendedModel) => ({
            id,
            object: "model",
            created: 0,
            owned_by: "cline",
            _: { name, description, tags, category },
          }),
        ),
      ),
    };
  },
});
