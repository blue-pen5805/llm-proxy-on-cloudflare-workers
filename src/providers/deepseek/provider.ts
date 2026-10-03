import { chatCompletionsEndpoint, jsonEndpoint } from "../inference";
import { defineProvider } from "../provider";

export const DeepSeek = defineProvider({
  endpoints: {
    chat_completions: chatCompletionsEndpoint(),

    responses: jsonEndpoint("/responses"),
    messages: jsonEndpoint("/anthropic/v1/messages"),

    models: { path: "/models" },
  },

  openAICompatible: true,
  apiKeyName: "DEEPSEEK_API_KEY",
  baseUrl: "https://api.deepseek.com",
  async buildHeadersForPath(pathname, headers, apiKeyIndex) {
    const merged = new Headers(headers);
    new Headers(await this.headers(apiKeyIndex)).forEach((value, key) =>
      merged.set(key, value),
    );
    if (pathname.startsWith("/anthropic/v1/messages")) {
      const authorization = merged.get("authorization");
      merged.delete("authorization");
      if (authorization)
        merged.set("x-api-key", authorization.slice("Bearer ".length));
    }
    return merged;
  },
});
