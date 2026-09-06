import { headersForRewrittenBody } from "../requests/response";
import { isJsonObject } from "../requests/sse";
import { readResponseJson } from "../utils/helpers";
import type { ChatConversionCodec } from "./inference";
import { nativeObject } from "./native_response";
import { prepareResponsesRequest } from "./responses_request";
import { convertResponsesJson } from "./responses_response";
import { responsesStream } from "./responses_stream";

export const responsesEndpoint: ChatConversionCodec = {
  prepare(data) {
    return { path: "/responses", data: prepareResponsesRequest(data) };
  },
  async transformResponse(response, model, request) {
    if (!response.ok) return response;
    if (
      response.body &&
      response.headers
        .get("content-type")
        ?.toLowerCase()
        .includes("text/event-stream")
    ) {
      return responsesStream(
        response,
        response.body,
        model,
        isJsonObject(request.stream_options) &&
          request.stream_options.include_usage === true,
      );
    }
    try {
      const body = convertResponsesJson(
        nativeObject(await readResponseJson(response, 5 * 1024 * 1024)),
        model,
      );
      const headers = headersForRewrittenBody(response.headers);
      headers.set("content-type", "application/json");
      return new Response(JSON.stringify(body), {
        status: response.status,
        headers,
      });
    } catch {
      return Response.json(
        {
          error: {
            message:
              "Upstream returned an invalid Responses inference response.",
            type: "api_error",
          },
        },
        { status: 502 },
      );
    }
  },
};
