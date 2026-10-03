import { Secrets } from "../../utils/secrets";
import { jsonEndpoint } from "../inference";
import { defineProvider } from "../provider";

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
  async headers(apiKeyIndex): Promise<HeadersInit> {
    const apiKey = Secrets.get(
      "HUGGINGFACE_API_KEY",
      apiKeyIndex,
      this.credentialProfile,
    );
    return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  },
});
