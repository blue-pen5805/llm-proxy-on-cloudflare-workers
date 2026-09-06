import { headersForRewrittenBody } from "../../requests/response";
import { readResponseJson } from "../../utils/helpers";
import { chatCompletionsEndpoint } from "../inference";
import { OpenAIModelsListResponseBody } from "../openai/types";
import { defineProvider } from "../provider";
import {
  ClineRecommendedModel,
  ClineRecommendedModelsResponseBody,
} from "./types";

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

export const Cline = defineProvider({
  endpoints: {
    chat_completions: chatCompletionsEndpoint(undefined, {
      async transformResponse(response): Promise<Response> {
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

        // The clone's branch was fully read; release the original's buffered tee
        // instead of holding it until garbage collection. A successful JSON parse
        // guarantees the body stream exists.
        await response.body!.cancel().catch(() => undefined);

        return new Response(JSON.stringify(body.data), {
          status: response.status,
          statusText: response.statusText,
          headers: headersForRewrittenBody(response.headers),
        });
      },
    }),

    models: {
      path: "/ai/cline/recommended-models",
      convertResponse(data): OpenAIModelsListResponseBody {
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
    },
  },

  openAICompatible: true,
  apiKeyName: "CLINE_API_KEY",
  baseUrl: "https://api.cline.bot/api/v1",
});
