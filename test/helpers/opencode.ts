export const opencodeCatalogUrl = "https://models.opencode.ai/api.json";

export function opencodeCatalog() {
  const provider = () => ({
    npm: "@ai-sdk/openai-compatible",
    api: "https://untrusted.example/never-used",
    models: {
      chat: {},
      inherited: { provider: {} },
      responses: { provider: { npm: "@ai-sdk/openai" } },
      messages: { provider: { npm: "@ai-sdk/anthropic" } },
      google: { provider: { npm: "@ai-sdk/google" } },
    },
  });
  return { opencode: provider(), "opencode-go": provider() };
}

export const opencodeChatRequest = {
  messages: [{ role: "user", content: "hello" }],
  max_tokens: 32,
};

export const responsesOutput = {
  id: "resp_example",
  created_at: 123,
  status: "completed",
  output: [
    { type: "message", content: [{ type: "output_text", text: "hello back" }] },
  ],
  usage: {
    input_tokens: 2,
    output_tokens: 3,
    input_tokens_details: { cached_tokens: 1 },
    output_tokens_details: { reasoning_tokens: 1 },
  },
};
