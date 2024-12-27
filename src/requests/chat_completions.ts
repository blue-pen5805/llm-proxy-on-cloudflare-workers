import { Secrets } from "../secrets";
import {
  AiGatewayEndpoint,
  OpenAICompatibleProviders,
} from "../providers/ai_gateway";
import { Providers } from "../providers";
import { safeJsonParse } from "../utils";
import { requestToUniversalEndpointItem } from "./universal_endpoint";

export async function chatCompletions(request: Request) {
  const headers = new Headers(request.headers);
  headers.delete("Authorization");

  const data = safeJsonParse(await request.text());
  if (typeof data === "string") {
    return new Response(
      JSON.stringify({
        error: "Invalid request.",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const [providerName, ...modelParts] = data["model"].split("/") as [
    string,
    string[],
  ];
  const model = modelParts.join("/");

  const provider = Providers[providerName];
  if (!Providers[providerName]) {
    return new Response(
      JSON.stringify({
        error: "Invalid provider.",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const providerClass = new provider.providerClass(provider.args);

  if (AiGatewayEndpoint.isActive(providerName)) {
    const retry = parseInt(Secrets.get("RETRY")) || 0;
    const endpoint = new AiGatewayEndpoint(undefined, providerClass.endpoint);
    const requestBody = providerClass.chatCompletionsRequestBody(
      JSON.stringify({
        ...data,
        model,
      }),
    );

    const body = new Array(1 + retry).fill(null).map(() => {
      const requestData = providerClass.chatCompletionsRequestData({
        body: requestBody,
        headers,
      });

      return requestToUniversalEndpointItem(providerName, requestData);
    });

    const response = await endpoint.fetch("", {
      method: "POST",
      body: JSON.stringify(body),
    });

    if (OpenAICompatibleProviders.includes(providerName)) {
      return response;
    }

    const isStream = (data.stream as boolean | undefined) === true;
    if (!isStream) {
      return providerClass.processChatCompletions(response, model);
    } else {
      return providerClass.processChatCompletionsStream(response, model);
    }
  } else {
    return await providerClass.chatCompletions({
      body: JSON.stringify({
        ...data,
        model,
      }),
      headers,
    });
  }
}
