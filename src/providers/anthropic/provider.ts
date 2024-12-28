import { createParser, EventSourceMessage } from "eventsource-parser";
import {
  OpenAIChatCompletionsChunkResponseBody,
  OpenAIChatCompletionsRequestBody,
  OpenAIChatCompletionsResponseBody,
} from "../openai/types";
import { ProviderBase } from "../provider";
import { AnthropicEndpoint } from "./endpoint";
import {
  AnthropicContent,
  AnthropicCreateMessageChunkResponseBody,
  AnthropicCreateMessageRequestBody,
  AnthropicCreateMessageResponseBody,
  AnthropicModelsListResponseBody,
} from "./types";

export class Anthropic extends ProviderBase {
  endpoint: AnthropicEndpoint;

  constructor({ apiKey }: { apiKey: keyof Env }) {
    super({ apiKey });
    this.endpoint = new AnthropicEndpoint(apiKey);
  }

  // OpenAI ComaptiQble API - Chat Completions
  async processChatCompletions(
    response: Response,
    _model?: string,
  ): Promise<Response> {
    const responseBody =
      (await response.json()) as AnthropicCreateMessageResponseBody;

    const stopReason = responseBody.stop_reason;
    const finishReason = stopReason
      ? stopReason == "end_turn"
        ? "stop"
        : stopReason === "max_tokens"
          ? "length"
          : stopReason === "stop_sequence"
            ? "stop"
            : stopReason === "tool_use"
              ? "tool_calls"
              : "stop"
      : "content_filter";
    const openaiResponse: OpenAIChatCompletionsResponseBody = {
      id: responseBody.id,
      choices: responseBody.content.map((content) => {
        return {
          finish_reason: finishReason,
          index: 0,
          message: {
            role: "assistant",
            content: content.type === "text" ? content.text : null,
            refusal: null,
          },
        };
      }),
      created: Date.now(),
      model: responseBody.model,
      service_tier: null,
      system_fingerprint: "",
      object: "chat.completion",
      usage: {
        completion_tokens: responseBody.usage.output_tokens,
        prompt_tokens: responseBody.usage.input_tokens,
        total_tokens:
          responseBody.usage.output_tokens + responseBody.usage.input_tokens,
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

    return await new Response(JSON.stringify(openaiResponse), response);
  }

  async processChatCompletionsStream(
    response: Response,
    _model?: string,
  ): Promise<Response> {
    let controller: TransformStreamDefaultController | undefined = undefined;

    let id = "";
    let model = "";
    const created = Date.now();
    const role = "assistant";
    let choice = undefined;

    function onEvent(event: EventSourceMessage) {
      const data = JSON.parse(
        event.data,
      ) as AnthropicCreateMessageChunkResponseBody;
      let chunk: string | null = null;

      switch (data.type) {
        case "message_start":
          id = data.message.id;
          model = data.message.model;

          const messageStartResponse: OpenAIChatCompletionsChunkResponseBody = {
            id,
            choices: [
              {
                finish_reason: null,
                index: 0,
                delta: {
                  role,
                  content: "",
                  refusal: null,
                },
              },
            ],
            created,
            model,
            service_tier: null,
            system_fingerprint: "",
            object: "chat.completion.chunk",
            usage: {
              completion_tokens: data.message.usage.output_tokens ?? 0,
              prompt_tokens: data.message.usage.input_tokens ?? 0,
              total_tokens:
                (data.message.usage.output_tokens ?? 0) +
                (data.message.usage.input_tokens ?? 0),
            },
          };

          chunk = JSON.stringify(messageStartResponse);
          break;
        case "message_delta":
          let finishReason = "stop";
          switch (data.delta.stop_reason) {
            case "end_turn":
              finishReason = "stop";
              break;
            case "max_tokens":
              finishReason = "length";
              break;
            case "stop_sequence":
              finishReason = "stop";
              break;
            case "tool_use":
              finishReason = "tool_calls";
              break;
          }
          const messageDeltaResponse: OpenAIChatCompletionsChunkResponseBody = {
            id,
            choices: [
              {
                index: 0,
                finish_reason: finishReason,
                delta: {
                  content: "",
                },
              },
            ],
            created,
            model,
            service_tier: null,
            system_fingerprint: "",
            object: "chat.completion.chunk",
            usage: {
              completion_tokens: data.usage.output_tokens ?? 0,
              prompt_tokens: data.usage.input_tokens ?? 0,
              total_tokens:
                (data.usage.output_tokens ?? 0) +
                (data.usage.input_tokens ?? 0),
            },
          };

          chunk = JSON.stringify(messageDeltaResponse);
          break;
        case "message_stop":
          chunk = "[DONE]";
          break;
        case "content_block_start":
          switch (data.content_block.type) {
            case "text":
              choice = {
                finish_reason: null,
                index: data.index,
                delta: {
                  role,
                  content: data.content_block.text,
                  refusal: null,
                },
              };
              break;
            case "tool_use":
              // Not Supported
              throw new Error("Tool use is not supported");
          }

          const contentBlockStartResponse: OpenAIChatCompletionsChunkResponseBody =
            {
              id,
              choices: [choice],
              created,
              model,
              service_tier: null,
              system_fingerprint: "",
              object: "chat.completion.chunk",
            };

          chunk = JSON.stringify(contentBlockStartResponse);
          break;
        case "content_block_delta":
          switch (data.delta.type) {
            case "text_delta":
              choice = {
                finish_reason: null,
                index: data.index,
                delta: {
                  role,
                  content: data.delta.text,
                  refusal: null,
                },
              };
              break;
            case "input_json_delta":
              // Not Supported
              throw new Error("Tool use is not supported");
          }

          const contentBlockDeltaResponse: OpenAIChatCompletionsChunkResponseBody =
            {
              id,
              choices: [choice],
              created,
              model,
              service_tier: null,
              system_fingerprint: "",
              object: "chat.completion.chunk",
            };

          chunk = JSON.stringify(contentBlockDeltaResponse);
          break;
        case "content_block_stop":
          break;
        case "error":
          console.error(data.error.type, data.error.message);
          break;
        case "ping":
          break;
        default:
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
    return this.endpoint.requestData("/v1/messages", {
      method: "POST",
      headers,
      body: this.chatCompletionsRequestBody(body),
    });
  }

  chatCompletionsRequestBody(body: string): string {
    const data = JSON.parse(body) as OpenAIChatCompletionsRequestBody;
    const { stream, model, messages, max_tokens, stop, temperature, top_p } =
      data;

    const systemMessage = messages.find((message) => message.role === "system");
    const system = systemMessage
      ? {
          type: "text" as const,
          text: Array.isArray(systemMessage.content)
            ? systemMessage.content.join()
            : systemMessage.content,
        }
      : undefined;

    const anthropicRequestBody: AnthropicCreateMessageRequestBody = {
      model,
      messages: messages
        .map((message) => {
          switch (message.role) {
            case "system":
              return null;
            case "user":
              if (!Array.isArray(message.content)) {
                return {
                  role: message.role,
                  content: message.content,
                };
              }

              const userContents: AnthropicContent[] = message.content.map(
                (content) => {
                  switch (content.type) {
                    case "text":
                      return {
                        type: "text",
                        text: content.text,
                      };
                    case "image_url":
                      // TODO: Implement image
                      throw new Error("Image URL is not supported");
                    case "input_audio":
                      // Not Supported
                      throw new Error("Input audio is not supported");
                    default:
                      return {
                        type: "text",
                        text: "",
                      };
                  }
                },
              );
              return {
                role: message.role,
                content: userContents,
              };
            case "assistant":
              if (!Array.isArray(message.content)) {
                return {
                  role: message.role,
                  content: message.content || "",
                };
              }

              const assistantContents: AnthropicContent[] = message.content.map(
                (content) => {
                  if ("text" in content) {
                    return {
                      type: "text",
                      text: content.text,
                    };
                  } else if ("refusal" in content) {
                    return {
                      type: "text",
                      text: content.refusal,
                    };
                  } else {
                    return {
                      type: "text",
                      text: "",
                    };
                  }
                },
              );

              return {
                role: message.role,
                content: assistantContents,
              };
            case "tool":
              // Not Supported
              throw new Error("Tool is not supported");
            default:
              throw new Error("Unexpected role");
          }
        })
        .filter((message) => message !== null),
      max_tokens: max_tokens || 1024,
      // metadata: {},
      stop_sequences: stop ? (Array.isArray(stop) ? stop : [stop]) : undefined,
      stream: stream || false,
      system,
      temperature: temperature || undefined,
      // tool_choice: {},
      // tools:[{}],
      // top_k: undefined,
      top_p: top_p || undefined,
    };

    return JSON.stringify(anthropicRequestBody);
  }

  async listModels() {
    const response = await this.fetchModels();
    const data = (await response.json()) as AnthropicModelsListResponseBody;

    return {
      object: "list",
      data: data.data.map(({ id, type, created_at, ...model }) => ({
        id,
        object: type,
        created: Math.floor(Date.parse(created_at) / 1000),
        owned_by: "anthropic",
        _: model,
      })),
    };
  }

  fetchModels(): Promise<Response> {
    return this.fetch("/v1/models", {
      method: "GET",
    });
  }
}
