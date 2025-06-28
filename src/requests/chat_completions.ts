import { CloudflareAIGateway } from "../ai_gateway";
import { Providers } from "../providers";
import { fetch2, safeJsonParse } from "../utils/helpers";
import { Config } from "../utils/config";
import { Secrets } from "../utils/secrets";

export async function chatCompletions(
  request: Request,
  aiGateway: CloudflareAIGateway | undefined = undefined,
) {
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
  const provider = Providers[providerName];
  if (!Providers[providerName]) {
    return new Response(
      JSON.stringify({
        error: "Invalid provider.",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Generate chat completions request
  const providerClass = new provider.providerClass();
  const [requestInfo, requestInit] = providerClass.buildChatCompletionsRequest({
    body: JSON.stringify({
      ...data,
      model,
    }),
    headers,
  });

  // If AI Gateway is enabled and the provider supports it, use AI Gateway
  if (
    aiGateway &&
    CloudflareAIGateway.isSupportedProvider(providerName, true)
  ) {
    return fetch2(
      ...aiGateway.buildChatCompletionsRequest({
        provider: providerName,
        body: requestInit.body as string,
        headers: {
          ...headers,
          Authorization: `Bearer ${Secrets.get(providerClass.apiKeyName as keyof Env)}`,
        },
      }),
    );
  }

  // Request to the provider endpoint
  return providerClass.fetch(requestInfo, requestInit);
}
