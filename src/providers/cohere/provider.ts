import { ProviderBase } from "../provider";
import { CohereEndpoint } from "./endpoint";
import { createParser, type EventSourceMessage } from "eventsource-parser";
import {
  CohereModelsListResponseBody,
  CohereV2ChatChunkResponse,
  CohereV2ChatResponse,
} from "./types";
import {
  OpenAIChatCompletionsChunkResponseBody,
  OpenAIChatCompletionsRequestBody,
  OpenAIChatCompletionsResponseBody,
} from "../openai/types";
import { fetch2 } from "../../utils";

export class Cohere extends ProviderBase {
  endpoint: CohereEndpoint;

  constructor({ apiKey }: { apiKey: keyof Env }) {
    super({ apiKey });
    this.endpoint = new CohereEndpoint(apiKey);
  }

  // OpenAI Comaptible API - Chat Completions
  async processChatCompletions(
    response: Response,
    model: string = "",
  ): Promise<Response> {
    const responseBody = (await response.json()) as CohereV2ChatResponse;
    const modifiedResponse: OpenAIChatCompletionsResponseBody = {
      id: responseBody.id,
      created: Date.now(),
      model,
      system_fingerprint: "",
      object: "chat.completion",
      service_tier: null,
      choices: [
        {
          finish_reason: responseBody.finish_reason as "stop",
          index: 0,
          message: responseBody.message.content.map((content) => ({
            role: responseBody.message.role,
            content: content.text,
            refusal: null,
            tool_calls:
              responseBody.message.tool_calls?.map((toolCall) => ({
                id: toolCall.id || "",
                type: "function",
                function: {
                  name: toolCall.function?.name || "",
                  arguments: toolCall.function?.arguments || "",
                },
              })) || [],
          }))[0],
          logprobs: null,
        },
      ],
      usage: {
        completion_tokens: responseBody.usage?.tokens.output_tokens || 0,
        prompt_tokens: responseBody.usage?.tokens.input_tokens || 0,
        total_tokens:
          (responseBody.usage?.tokens.input_tokens || 0) +
          (responseBody.usage?.tokens.output_tokens || 0),
        completion_tokens_details: {
          accepted_prediction_tokens: 0,
          audio_tokens: 0,
          reasoning_tokens: 0,
          rejected_prediction_tokens: 0,
        },
        prompt_tokens_details: {
          audio_tokens: 0,
          cached_tokens: 0,
        },
      },
    };

    return await new Response(JSON.stringify(modifiedResponse), response);
  }

  async processChatCompletionsStream(
    response: Response,
    model: string = "",
  ): Promise<Response> {
    let controller: TransformStreamDefaultController | undefined = undefined;

    function onEvent(event: EventSourceMessage) {
      if (event.data === "[DONE]") {
        controller?.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        return;
      }

      const data = JSON.parse(event.data) as CohereV2ChatChunkResponse;
      let chunk: string | null = null;

      let id = "";
      let role = "assistant";
      switch (data.type) {
        case "message-start":
          id = data.id || "";
          role = data.delta?.message.role || "assistant";
          break;
        case "content-start":
          const contentStartResponse: OpenAIChatCompletionsChunkResponseBody = {
            id,
            choices: [
              {
                finish_reason: null,
                index: 0,
                delta: {
                  role,
                  content: data.delta?.message.content.text || "",
                  refusal: null,
                  tool_calls: [],
                },
                logprobs: null,
              },
            ],
            created: Date.now(),
            model,
            service_tier: null,
            system_fingerprint: "",
            object: "chat.completion.chunk",
          };
          chunk = JSON.stringify(contentStartResponse);
          break;
        case "content-delta":
          const contentDeltaResponse: OpenAIChatCompletionsChunkResponseBody = {
            id,
            choices: [
              {
                finish_reason: null,
                index: 0,
                delta: {
                  role,
                  content: data.delta?.message.content.text || "",
                  refusal: null,
                  tool_calls: [],
                },
                logprobs: null,
              },
            ],
            created: Date.now(),
            model,
            service_tier: null,
            system_fingerprint: "",
            object: "chat.completion.chunk",
          };
          chunk = JSON.stringify(contentDeltaResponse);
          break;
        case "content-end":
          // TODO: Implement content end handling
          break;
        case "tool-plan-delta":
          // TODO: Implement tool plan handling
          break;
        case "tool-call-start":
          // TODO: Implement tool call handling
          break;
        case "tool-call-delta":
          // TODO: Implement tool call handling
          break;
        case "tool-call-end":
          // TODO: Implement tool call handling
          break;
        case "citation-start":
          // TODO: Implement citation handling
          break;
        case "citation-end":
          // TODO: Implement citation handling
          break;
        case "message-end":
          const messageEndResponse: OpenAIChatCompletionsChunkResponseBody = {
            id,
            choices: [
              {
                finish_reason: "stop",
                index: 0,
                delta: {},
                logprobs: null,
              },
            ],
            created: Date.now(),
            model,
            service_tier: null,
            system_fingerprint: "",
            object: "chat.completion.chunk",
            usage: {
              completion_tokens:
                data.delta?.usage?.billed_units?.output_tokens || 0,
              prompt_tokens: data.delta?.usage?.billed_units?.input_tokens || 0,
              total_tokens:
                (data.delta?.usage?.billed_units?.input_tokens || 0) +
                (data.delta?.usage?.billed_units?.output_tokens || 0),
            },
          };
          chunk = JSON.stringify(messageEndResponse);
          break;
        case "debug":
          break;
      }

      if (chunk) {
        controller?.enqueue(new TextEncoder().encode(`data: ${chunk}\n\n`));
        chunk = null;
      }
    }

    const parser = createParser({ onEvent });
    const { readable, writable } = new TransformStream<Uint8Array, any>({
      transform(chunk, aController) {
        controller ||= aController;
        const body = new TextDecoder().decode(chunk);
        parser.feed(body);
      },
    });
    response.body?.pipeTo(writable);

    return new Response(readable, response);
  }

  chatCompletionsRequestData({
    body,
    headers = {},
  }: {
    body: string;
    headers: HeadersInit;
  }) {
    return this.endpoint.requestData("/v2/chat", {
      method: "POST",
      headers,
      body: this.chatCompletionsRequestBody(body),
    });
  }

  chatCompletionsRequestBody(body: string): string {
    const data = JSON.parse(body as string) as OpenAIChatCompletionsRequestBody;
    const {
      stream,
      model,
      messages,
      response_format,
      max_tokens,
      max_completion_tokens,
      stop,
      temperature,
      seed,
      frequency_penalty,
      presence_penalty,
    } = data;

    const cohereRequestBody = {
      stream,
      model,
      messages,
      response_format,
      max_tokens,
      max_completion_tokens,
      stop,
      temperature,
      seed,
      frequency_penalty,
      presence_penalty,
    };

    return JSON.stringify(cohereRequestBody);
  }

  async listModels() {
    const response = await this.fetchModels();
    const data = (await response.json()) as CohereModelsListResponseBody;

    return {
      object: "list",
      data: data.models.map(({ name, ...model }) => ({
        id: name,
        object: "model",
        created: 0,
        owned_by: "cohere",
        _: model,
      })),
    };
  }

  async fetchModels() {
    return await this.fetch("/v1/models?page_size=100&endpoint=chat", {
      method: "GET",
    });
  }
}
