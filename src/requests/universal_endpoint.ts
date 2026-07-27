import { CloudflareAIGateway } from "../ai_gateway";
import {
  CloudflareAIGatewayUniversalEndpointData,
  CloudflareAIGatewayUniversalEndpointStep,
} from "../ai_gateway/const";
import { addProxyAiGatewayMetadata } from "../ai_gateway/metadata";
import { isCloudflareAIGatewayProvider } from "../ai_gateway/utils";
import type { ProviderRegistry } from "../providers";
import { parseProviderSelector } from "../providers/profile";
import { recordApiKeySelection } from "../utils/api_key_selection";
import { stripProxyAuthorizationHeaders } from "../utils/authorization";
import { BadRequestError } from "../utils/error";
import { fetchWithLogging, readJsonRequest } from "../utils/helpers";
import { RequestLogger } from "../utils/logger";

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
const MAX_UNIVERSAL_ENDPOINT_PATH_LENGTH = 2048;

function normalizeUniversalEndpointPath(endpoint: string): string {
  const normalized = endpoint.replace(/^\/+/, "");
  if (
    normalized.length === 0 ||
    normalized.length > MAX_UNIVERSAL_ENDPOINT_PATH_LENGTH ||
    /[\\\u0000-\u001f\u007f]/.test(normalized) ||
    /^[a-z][a-z\d+.-]*:/i.test(normalized) ||
    normalized.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new BadRequestError(
      "Universal Endpoint step endpoint must be a safe relative path.",
    );
  }
  return normalized;
}

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
  providerRegistry: ProviderRegistry,
): Promise<Response> {
  const endpointRequests = parseUniversalEndpointRequests(
    await readJsonRequest(request),
  );
  RequestLogger.start({ endpoint: "universal_endpoint" });
  const gatewayHeaders = stripProxyAuthorizationHeaders(request.headers, {
    preserveAiGatewayHeaders: true,
  });
  addProxyAiGatewayMetadata(gatewayHeaders, {
    endpoint: "universal_endpoint",
  });
  const clientGatewayHeaders: Record<string, string> = {};
  gatewayHeaders.forEach((value, key) => {
    if (key.startsWith("cf-aig-")) {
      clientGatewayHeaders[key] = value;
    }
  });

  const gatewaySteps: CloudflareAIGatewayUniversalEndpointData =
    await Promise.all(
      endpointRequests.map(
        async (
          endpointRequest,
          stepIndex,
        ): Promise<CloudflareAIGatewayUniversalEndpointStep> => {
          const providerSelector = endpointRequest.provider;
          /* istanbul ignore next -- request validation requires provider on every step */
          if (!providerSelector) {
            throw new BadRequestError(`Provider not specified.`);
          }
          const parsedSelector = parseProviderSelector(providerSelector);
          if (!parsedSelector) {
            throw new BadRequestError(
              `Provider ${providerSelector} is not supported.`,
            );
          }
          const { providerName, profile } = parsedSelector;
          if (isCloudflareAIGatewayProvider(providerName) === false) {
            throw new BadRequestError(
              `Provider ${providerName} is not supported.`,
            );
          }
          const providerInstance = providerRegistry.get(providerSelector);
          if (!providerInstance) {
            throw new BadRequestError(
              `Provider ${providerName} is not supported by this proxy.`,
            );
          }
          const endpointPath = normalizeUniversalEndpointPath(
            endpointRequest.endpoint ?? providerInstance.chatCompletionPath,
          );
          const apiKeyIndex = await providerInstance.getNextApiKeyIndex();
          const apiKeys = providerInstance.getApiKeys();
          recordApiKeySelection({
            provider: providerName,
            credentialProfile: profile,
            operation: "universal_endpoint",
            keyIndex: apiKeyIndex,
            keyCount: apiKeys.length,
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
    headers: clientGatewayHeaders,
  });
  return fetchWithLogging(requestInfo, {
    ...requestInit,
    signal: request.signal,
  });
}
