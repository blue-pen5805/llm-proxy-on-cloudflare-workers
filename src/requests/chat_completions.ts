import { CloudflareAIGateway } from "../ai_gateway";
import { MiddlewareContext } from "../middleware";
import { getProvider } from "../providers";
import { Config } from "../utils/config";
import { Environments } from "../utils/environments";
import { fetch2, safeJsonParse } from "../utils/helpers";
import { Secrets } from "../utils/secrets";

export async function chatCompletions(
  context: MiddlewareContext,
  aiGateway: CloudflareAIGateway | undefined = undefined,
) {
  const { request, apiKeyIndex: contextApiKeyIndex } = context;
  // Remove Authorization header to prevent it from being sent to the provider
  const headers = new Headers(request.headers);
  headers.delete("Authorization");

  // Validate Request Data Structure
  const data = safeJsonParse(await request.text());
  if (typeof data === "string") {
    return new Response(
      JSON.stringify({
        error: "Invalid request.",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Split model into provider and model name
  const [providerName, ...modelParts] = (
    data["model"] === "default" ? Config.defaultModel() : data["model"]
  ).split("/") as [string, string];
  const model = modelParts.join("/");

  // Validate provider name
  const provider = getProvider(providerName, Environments.all());
  if (!provider) {
    return new Response(
      JSON.stringify({
        error: "Invalid provider.",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Get API key apiKeyIndex
  const apiKeyIndex =
    contextApiKeyIndex !== undefined
      ? Secrets.resolveApiKeyIndex(
          contextApiKeyIndex,
          provider.getApiKeys().length,
        )
      : await provider.getNextApiKeyIndex();

  // Generate chat completions request
  const [requestInfo, requestInit] = await provider.buildChatCompletionsRequest(
    {
      body: JSON.stringify({
        ...data,
        model,
      }),
      headers,
      apiKeyIndex,
    },
  );

  // If AI Gateway is enabled and the provider supports it, use AI Gateway
  if (
    aiGateway &&
    CloudflareAIGateway.isSupportedProvider(providerName, true)
  ) {
    return fetch2(
      ...(await aiGateway.buildChatCompletionsRequest({
        provider: providerName,
        body: requestInit.body as string,
        headers: {
          ...requestInit.headers,
        },
        apiKeyName: provider.apiKeyName as keyof Env,
      })),
    );
  }

  // Request to the provider endpoint
  return provider.fetch(requestInfo, requestInit);
}
