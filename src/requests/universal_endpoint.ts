import { CloudflareAIGateway } from "../ai_gateway";
import {
  CloudflareAIGatewayUniversalEndpointData,
  CloudflareAIGatewayUniversalEndpointStep,
} from "../ai_gateway/const";
import { isCloudflareAIGatewayProvider } from "../ai_gateway/utils";
import { BUILT_IN_PROVIDER_CONSTRUCTORS } from "../providers";
import { recordApiKeySelection } from "../utils/api_key_selection";
import { stripProxyAuthorizationHeaders } from "../utils/authorization";
import { BadRequestError } from "../utils/error";
import { fetchWithLogging, readJsonRequest } from "../utils/helpers";
import { Secrets } from "../utils/secrets";

type UniversalEndpointRequest = {
  provider?: string;
  endpoint?: string;
  headers?: { [key: string]: string };
  query: {
    model?: string;
    [key: string]: unknown;
  };
};

export const MAX_UNIVERSAL_ENDPOINT_STEPS = 16;

function parseUniversalEndpointRequests(
  value: unknown,
): UniversalEndpointRequest[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BadRequestError(
      "Universal Endpoint body must be a non-empty array.",
    );
  }
  if (value.length > MAX_UNIVERSAL_ENDPOINT_STEPS) {
    throw new BadRequestError(
      `Universal Endpoint accepts at most ${MAX_UNIVERSAL_ENDPOINT_STEPS} steps.`,
    );
  }

  for (const step of value) {
    if (typeof step !== "object" || step === null || Array.isArray(step)) {
      throw new BadRequestError(
        "Each Universal Endpoint step must be an object.",
      );
    }
    const record = step as Record<string, unknown>;
    if (typeof record.provider !== "string" || !record.provider) {
      throw new BadRequestError(
        "Each Universal Endpoint step requires a provider.",
      );
    }
    if (record.endpoint !== undefined && typeof record.endpoint !== "string") {
      throw new BadRequestError(
        "Universal Endpoint step endpoint must be a string.",
      );
    }
    if (
      typeof record.query !== "object" ||
      record.query === null ||
      Array.isArray(record.query)
    ) {
      throw new BadRequestError(
        "Each Universal Endpoint step requires a query object.",
      );
    }
    if (record.headers !== undefined) {
      if (
        typeof record.headers !== "object" ||
        record.headers === null ||
        Array.isArray(record.headers)
      ) {
        throw new BadRequestError(
          "Universal Endpoint step headers must be an object.",
        );
      }
      if (
        Object.values(record.headers).some(
          (header) => typeof header !== "string",
        )
      ) {
        throw new BadRequestError(
          "Universal Endpoint header values must be strings.",
        );
      }
    }
  }
  return value as UniversalEndpointRequest[];
}

export async function handleUniversalEndpointRequest(
  request: Request,
  aiGateway: CloudflareAIGateway,
) {
  const endpointRequests = parseUniversalEndpointRequests(
    await readJsonRequest(request),
  );

  const gatewaySteps: CloudflareAIGatewayUniversalEndpointData =
    await Promise.all(
      endpointRequests.map(
        async (
          endpointRequest,
          stepIndex,
        ): Promise<CloudflareAIGatewayUniversalEndpointStep> => {
          const providerName = endpointRequest.provider;
          if (!providerName) {
            throw new BadRequestError(`Provider not specified.`);
          }
          if (isCloudflareAIGatewayProvider(providerName) === false) {
            throw new BadRequestError(
              `Provider ${providerName} is not supported.`,
            );
          }
          const ProviderConstructor =
            BUILT_IN_PROVIDER_CONSTRUCTORS[providerName];
          const providerInstance = new ProviderConstructor();
          const endpointPath =
            endpointRequest.endpoint ||
            providerInstance.chatCompletionPath.replace("/", "");
          const apiKeyName = providerInstance.apiKeyName as keyof Env;
          const apiKeyIndex = await Secrets.getNext(apiKeyName);
          recordApiKeySelection({
            provider: providerName,
            operation: "universal_endpoint",
            keyIndex: apiKeyIndex,
            keyCount: Secrets.getAll(apiKeyName).length,
            selectionPolicy: "automatic_rotation",
            viaAiGateway: true,
            step: stepIndex,
          });
          const requestHeaders = stripProxyAuthorizationHeaders(
            endpointRequest.headers ?? {},
          );
          const providerHeaders = new Headers(
            await providerInstance.headers(apiKeyIndex),
          );
          providerHeaders.forEach((value, key) =>
            requestHeaders.set(key, value),
          );

          return {
            provider: providerName,
            endpoint: endpointPath,
            headers: Object.fromEntries(requestHeaders.entries()),
            query: endpointRequest.query,
          };
        },
      ),
    );

  const [requestInfo, requestInit] = aiGateway.buildUniversalEndpointRequest({
    data: gatewaySteps,
  });
  return fetchWithLogging(requestInfo, {
    ...requestInit,
    signal: request.signal,
  });
}
