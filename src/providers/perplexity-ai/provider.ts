import { chatCompletionsEndpoint, jsonEndpoint } from "../inference";
import { defineProvider } from "../provider";

const agentResponsesEndpoint = jsonEndpoint("/v1/responses");

export const PerplexityAi = defineProvider({
  endpoints: {
    chat_completions: chatCompletionsEndpoint("/v1/chat/completions", {
      prepareGateway(data) {
        return {
          path: data.model.includes("/")
            ? "/v1/chat/completions"
            : "/chat/completions",
          data,
        };
      },
    }),
  },

  resolveEndpoint(model, protocol) {
    return protocol === "responses" && model.includes("/")
      ? agentResponsesEndpoint
      : undefined;
  },
  openAICompatible: true,
  apiKeyName: "PERPLEXITYAI_API_KEY",
  baseUrl: "https://api.perplexity.ai",
});
