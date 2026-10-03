import { headersForRewrittenBody } from "../requests/response";
import { isJsonObject, type JsonObject } from "../requests/sse";
import { BadRequestError } from "../utils/error";
import { readResponseJson } from "../utils/helpers";
import type { ChatConversionCodec } from "./inference";
import { prepareNativeRequest, type NativeProtocol } from "./native_request";
import { convertNativeJson, nativeObject } from "./native_response";
import { nativeStream } from "./native_stream";

export async function transformNativeResponse(
  response: Response,
  protocol: NativeProtocol,
  model: string,
  request: Readonly<JsonObject>,
): Promise<Response> {
  if (!response.ok) return response;
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (
    response.body &&
    (contentType.includes("text/event-stream") ||
      contentType.includes("application/vnd.amazon.eventstream"))
  ) {
    const includeUsage =
      isJsonObject(request.stream_options) &&
      request.stream_options.include_usage === true;
    return nativeStream(response, response.body, protocol, model, includeUsage);
  }
  try {
    const converted = convertNativeJson(
      nativeObject(await readResponseJson(response, 5 * 1024 * 1024)),
      protocol,
      model,
    );
    const headers = headersForRewrittenBody(response.headers);
    headers.set("content-type", "application/json");
    return new Response(JSON.stringify(converted), {
      status: response.status,
      headers,
    });
  } catch {
    return Response.json(
      {
        error: {
          message: "Upstream returned an invalid native inference response.",
          type: "api_error",
        },
      },
      { status: 502 },
    );
  }
}

export const messagesEndpoint: ChatConversionCodec = {
  prepare(data) {
    return {
      path: "/v1/messages",
      data: prepareNativeRequest(data, "messages"),
    };
  },
  transformResponse(response, model, request) {
    return transformNativeResponse(response, "messages", model, request);
  },
};

export const generateContentEndpoint: ChatConversionCodec = {
  prepare(data) {
    return {
      path: `/v1beta/models/${encodeURIComponent(data.model.replace(/^models\//, ""))}:${data.stream ? "streamGenerateContent?alt=sse" : "generateContent"}`,
      data: prepareNativeRequest(data, "generateContent"),
    };
  },
  transformResponse(response, model, request) {
    return transformNativeResponse(response, "generateContent", model, request);
  },
};

export const converseEndpoint: ChatConversionCodec = {
  prepare(data) {
    if (/^(?:\.{1,2})?$/.test(data.model)) {
      throw new BadRequestError("Invalid Bedrock model identifier.");
    }
    return {
      path: `/model/${encodeURIComponent(data.model)}/${data.stream ? "converse-stream" : "converse"}`,
      data: prepareNativeRequest(data, "converse"),
    };
  },
  transformResponse(response, model, request) {
    return transformNativeResponse(response, "converse", model, request);
  },
};
