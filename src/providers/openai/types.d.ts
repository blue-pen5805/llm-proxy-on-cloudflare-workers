// --- Chat Completions ---
// https://platform.openai.com/docs/api-reference/chat/object
export type OpenAIChatCompletionsRequestBody = {
  messages: (
    | {
        content: string | string[];
        role: "system";
        name?: string;
      }
    | {
        content:
          | string
          | (
              | {
                  type: "text";
                  text: string;
                }
              | {
                  type: "image_url";
                  image_url: {
                    url: string;
                    detail?: "auto" | "high" | "low";
                  };
                }
              | {
                  type: "input_audio";
                  input_audio: {
                    data: string;
                    format: "wav" | "mp3";
                  };
                }
            )[];
        role: "user";
        name?: string;
      }
    | {
        content?:
          | string
          | (
              | {
                  type: string;
                  text: string;
                }
              | {
                  type: string;
                  refusal: string;
                }
            )[];
        refusal?: string | null;
        role: "assistant";
        name?: string;
        audio?: {
          id: string;
        } | null;
        tool_calls?: {
          id: string;
          type: string;
          function: {
            name: string;
            arguments: string;
          };
        }[];
        function_call?: any | null; // deprecated
      }
    | {
        role: "tool";
        content: string | string[];
        tool_call_id: string;
      }
    | {
        // deprecated
        role: "function";
        content: string | null;
        name: string;
      }
  )[];
  model: string;
  store?: boolean | null;
  metadata?: Record<string, any> | null;
  frequency_penalty?: number | null;
  logit_bias?: Record<string, number> | null;
  logprobs?: number | null;
  max_tokens?: number | null; // deprecated
  max_completion_tokens?: number | null;
  n?: number | null;
  modalities?: string[] | null;
  prediction?: {
    type: "content";
    content:
      | string
      | {
          type: string;
          text: string;
        }[];
  } | null;
  audio?: {
    voice: string;
    format: string;
  } | null;
  presence_penalty?: number | null;
  response_format?:
    | {
        type: "text" | "json_object";
      }
    | {
        type: "json_schema";
        json_schema: Record<string, any>;
      };
  seed?: number | null;
  service_tier?: string | null;
  stop?: string | string[] | null;
  stream?: boolean | null;
  stream_options?: {
    include_usage?: boolean;
  } | null;
  suffix?: string | null;
  temperature?: number | null;
  top_p?: number | null;
  tools?: {
    type: "function";
    function: {
      description?: string;
      name: string;
      parameters?: Record<string, any>;
      strict?: boolean | null;
    };
  }[];
  tool_choice?: string | { type: "function"; function: { name: string } };
  parallel_tool_calls?: boolean;
  user?: string;
  function_call?:
    | string
    | {
        name: string;
      }; // deprecated
  functions?: {
    description?: string;
    name: string;
    parameters: Record<string, any>;
  }[]; // deprecated
};

export type OpenAIChatCompletionsResponseBody = {
  id: string;
  choices: {
    finish_reason:
      | "stop"
      | "length"
      | "content_filter"
      | "tool_calls"
      | "function_call";
    index: number;
    message: {
      role: string;
      content: string | null;
      refusal: string | null;
      tool_calls?: {
        id: string;
        type: string;
        function: {
          name: string;
          arguments: string;
        };
      }[];
      audio?: {
        id: string;
        expires_at: number;
        data: string;
        transcript: string;
      } | null;
    };
    logprobs?: {
      content: any[];
      refusal: any[];
    } | null;
  }[];
  created: number;
  model: string;
  service_tier: string | null;
  system_fingerprint: string;
  object: "chat.completion";
  usage: {
    completion_tokens: number;
    prompt_tokens: number;
    total_tokens: number;
    completion_tokens_details: {
      accepted_prediction_tokens: number;
      audio_tokens: number;
      reasoning_tokens: number;
      rejected_prediction_tokens: number;
    };
    prompt_tokens_details: {
      audio_tokens: number;
      cached_tokens: number;
    };
  };
};

// https://platform.openai.com/docs/api-reference/chat/streaming
export type OpenAIChatCompletionsChunkResponseBody = {
  id: string;
  choices: {
    delta:
      | {
          role: string;
          content: string | null;
          refusal: string | null;
          tool_calls: {
            index: number;
            id: string;
            type: string;
            function: {
              name: string;
              arguments: string;
            };
          }[];
        }
      | object;
    logprobs?: {
      content: any[];
      refusal: any[];
    } | null;
    finish_reason: string | null;
    index: number;
  }[];
  created: number;
  model: string;
  service_tier: string | null;
  system_fingerprint: string;
  object: "chat.completion.chunk";
  usage?: {
    completion_tokens: number;
    prompt_tokens: number;
    total_tokens: number;
  } | null;
};

// --- Models ---
// https://platform.openai.com/docs/api-reference/models/object
export type OpenAIModelsListResponseBody = {
  object: string;
  data: {
    id: string;
    object: string;
    created: number;
    owned_by: string;
    _?: any;
  }[];
};
