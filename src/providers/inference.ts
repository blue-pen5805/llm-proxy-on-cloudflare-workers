import type { JsonObject } from "../requests/sse";
import { chatParameterFilter } from "./chat_parameters";
import type { OpenAIChatCompletionsRequestBody } from "./openai/types";
import type { Provider } from "./provider";

export type PublicInferenceProtocol =
  | "chat_completions"
  | "responses"
  | "messages";

export interface InferenceRequestArguments {
  data: JsonObject & { model: string };
  headers: HeadersInit;
  apiKeyIndex?: number;
  target: "direct" | "gateway" | "custom-gateway";
}

export interface PreparedInferenceRequest {
  path: string;
  data: JsonObject;
}

type PrepareInference = (
  this: Provider,
  data: JsonObject & { model: string },
  apiKeyIndex?: number,
) => PreparedInferenceRequest;

export interface InferenceUpstream {
  /** Internal Custom Provider name; not a public model selector. */
  readonly name: string;
  baseUrl(): string;
}

export interface InferenceEndpoint {
  /** Fixed provider-relative path, also usable as a Universal Endpoint default. */
  readonly path?: string;
  readonly supportsAiGateway?: boolean;
  /** An inference origin distinct from the provider's pass-through origin. */
  readonly upstream?: InferenceUpstream;
  readonly transport?: "workers-ai-rest";
  readonly requiresAiGateway?: boolean;
  buildRequest(
    this: Provider,
    args: InferenceRequestArguments,
  ): Promise<[string, RequestInit]>;
  transformResponse?(
    this: Provider,
    response: Response,
    model: string,
    request: Readonly<JsonObject>,
  ): Promise<Response>;
}

export interface ResolvedInference {
  readonly endpoint: InferenceEndpoint;
  /** True when the selected operation consumes the requested public protocol. */
  readonly native: boolean;
}

interface JsonEndpointOptions {
  supportsAiGateway?: boolean;
  upstream?: InferenceUpstream;
  transport?: "workers-ai-rest";
  requiresAiGateway?: boolean;
  /** Some operations omit the provider's compatibility path prefix. */
  usePathnamePrefix?: boolean;
  /** Returns an already resolved native Gateway path when its API differs. */
  prepareGateway?: PrepareInference;
  transformResponse?: InferenceEndpoint["transformResponse"];
}

/** Executable operation: prepare once per attempted credential, serialize, then authenticate. */
export function jsonEndpoint(
  pathOrPrepare: string | PrepareInference,
  options: JsonEndpointOptions = {},
): InferenceEndpoint {
  return {
    ...(typeof pathOrPrepare === "string" && !options.upstream
      ? { path: pathOrPrepare }
      : {}),
    supportsAiGateway: options.supportsAiGateway,
    upstream: options.upstream,
    transport: options.transport,
    requiresAiGateway: options.requiresAiGateway,
    transformResponse: options.transformResponse,
    async buildRequest({ data, headers, apiKeyIndex, target }) {
      const prepareGateway = target === "gateway" && options.prepareGateway;
      const prepared = prepareGateway
        ? prepareGateway.call(this, data, apiKeyIndex)
        : typeof pathOrPrepare === "string"
          ? { path: pathOrPrepare, data }
          : pathOrPrepare.call(this, data, apiKeyIndex);
      const prefix =
        options.usePathnamePrefix === false ? "" : this.pathnamePrefix();
      const path =
        target === "custom-gateway"
          ? prefix + prepared.path
          : target === "gateway"
            ? prepareGateway
              ? prepared.path
              : this.aiGatewayPath(prefix + prepared.path)
            : (options.upstream ?? this).baseUrl() + prefix + prepared.path;
      const jsonHeaders = new Headers(headers);
      jsonHeaders.set("content-type", "application/json");
      return [
        path,
        {
          method: "POST",
          body: JSON.stringify(prepared.data),
          headers: await this.buildHeadersForPath(
            prepared.path,
            jsonHeaders,
            apiKeyIndex,
          ),
        },
      ];
    },
  };
}

interface ChatEndpointOptions extends JsonEndpointOptions {
  supportedParameters?: readonly (keyof OpenAIChatCompletionsRequestBody)[];
}

/** Chat filtering belongs to the operation, independently of provider authentication. */
export function chatCompletionsEndpoint(
  path = "/chat/completions",
  options: ChatEndpointOptions = {},
): InferenceEndpoint {
  const filter = chatParameterFilter(options.supportedParameters);
  const prepareGateway = options.prepareGateway;
  return {
    ...jsonEndpoint(
      function (data) {
        return { path, data: filter(data) as JsonObject };
      },
      {
        ...options,
        ...(prepareGateway
          ? {
              prepareGateway(data, apiKeyIndex) {
                return prepareGateway.call(
                  this,
                  filter(data) as JsonObject & { model: string },
                  apiKeyIndex,
                );
              },
            }
          : {}),
      },
    ),
    ...(options.upstream ? {} : { path }),
  };
}

/** A Chat-to-provider adapter pairs request and response codecs. */
export interface ChatConversionCodec {
  prepare(data: JsonObject & { model: string }): PreparedInferenceRequest;
  transformResponse(
    response: Response,
    model: string,
    request: Readonly<JsonObject>,
  ): Promise<Response>;
}

export function convertedChatEndpoint(
  codec: ChatConversionCodec,
  options: ChatEndpointOptions = {},
): InferenceEndpoint {
  const filter = chatParameterFilter(options.supportedParameters);
  return jsonEndpoint(
    (data) => {
      return codec.prepare(filter(data) as JsonObject & { model: string });
    },
    {
      usePathnamePrefix: false,
      transformResponse: codec.transformResponse,
      ...options,
      ...(options.prepareGateway
        ? {
            prepareGateway(data, apiKeyIndex) {
              return options.prepareGateway!.call(
                this,
                filter(data) as JsonObject & { model: string },
                apiKeyIndex,
              );
            },
          }
        : {}),
    },
  );
}
