import { Secrets } from "../../utils/secrets";
import { jsonEndpoint } from "../inference";
import { defineProvider } from "../provider";

const inferencePaths = new Set([
  "/v1/chat/completions",
  "/v1/responses",
  "/v1/messages",
]);
const inferenceUpstream = {
  name: "huggingface/inference",
  baseUrl: () => "https://router.huggingface.co",
};

export const HuggingFace = defineProvider({
  endpoints: {
    chat_completions: jsonEndpoint("/v1/chat/completions", {
      upstream: inferenceUpstream,
    }),
    responses: jsonEndpoint("/v1/responses", { upstream: inferenceUpstream }),
    messages: jsonEndpoint("/v1/messages", { upstream: inferenceUpstream }),
  },

  apiKeyName: "HUGGINGFACE_API_KEY",
  baseUrl: "https://api-inference.huggingface.co/models",
  async buildHeadersForPath(pathname, headers, apiKeyIndex) {
    const merged = new Headers(headers);
    if (inferencePaths.has(pathname)) {
      const apiKey = Secrets.get(
        "HUGGINGFACE_API_KEY",
        apiKeyIndex,
        this.credentialProfile,
      );
      if (apiKey) merged.set("authorization", `Bearer ${apiKey}`);
    }
    return merged;
  },
});
