// --- Chat Completions ---
// https://platform.openai.com/docs/api-reference/chat/object
export type OpenAIChatCompletionsRequestBody = {
  messages: (
    | {
        content:
          | string
          | {
              type: "text";
              text: string;
              prompt_cache_breakpoint?: { mode: "explicit" };
            }[];
        role: "system";
        name?: string;
      }
    | {
        content:
          | string
          | {
              type: "text";
              text: string;
              prompt_cache_breakpoint?: { mode: "explicit" };
            }[];
        role: "developer";
        name?: string;
      }
    | {
        content:
          | string
          | (
              | {
                  type: "text";
                  text: string;
                  prompt_cache_breakpoint?: { mode: "explicit" };
                }
              | {
                  type: "image_url";
                  image_url: {
                    url: string;
                    detail?: "auto" | "high" | "low";
                  };
                  prompt_cache_breakpoint?: { mode: "explicit" };
                }
              | {
                  type: "file";
                  file: {
                    file_data?: string;
                    file_id?: string;
                    filename?: string;
                  };
                  prompt_cache_breakpoint?: { mode: "explicit" };
                }
              | {
                  type: "input_audio";
                  input_audio: {
                    data: string;
                    format: "wav" | "mp3";
                  };
                  prompt_cache_breakpoint?: { mode: "explicit" };
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
                  prompt_cache_breakpoint?: { mode: "explicit" };
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
          type: "function" | "custom";
          function?: {
            name: string;
            arguments: string;
          };
          custom?: {
            name: string;
            input: string;
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
  logprobs?: boolean | null;
  top_logprobs?: number | null;
  max_tokens?: number | null; // deprecated
  max_completion_tokens?: number | null;
  reasoning_effort?: string | null;
  n?: number | null;
  modalities?: string[] | null;
  moderation?: Record<string, any> | null;
  prediction?: {
    type: "content";
    content:
      | string
      | {
          type: string;
          text: string;
          prompt_cache_breakpoint?: { mode: "explicit" };
        }[];
  } | null;
  audio?: {
    voice: string;
    format: string;
  } | null;
  presence_penalty?: number | null;
  prompt_cache_key?: string | null;
  prompt_cache_options?: {
    mode?: "implicit" | "explicit";
    ttl?: "30m";
  };
  prompt_cache_retention?: "in_memory" | "24h" | null;
  response_format?:
    | {
        type: "text" | "json_object";
      }
    | {
        type: "json_schema";
        json_schema: Record<string, any>;
      };
  safety_identifier?: string | null;
  seed?: number | null;
  service_tier?: string | null;
  stop?: string | string[] | null;
  stream?: boolean | null;
  stream_options?: {
    include_obfuscation?: boolean;
    include_usage?: boolean;
  } | null;
  /** Provider-specific legacy extension; not part of current OpenAI Chat Completions. */
  suffix?: string | null;
  temperature?: number | null;
  top_p?: number | null;
  tools?: (
    | {
        type: "function";
        function: {
          description?: string;
          name: string;
          parameters?: Record<string, any>;
          strict?: boolean | null;
        };
      }
    | {
        type: "custom";
        custom: {
          description?: string;
          name: string;
          format?: Record<string, any>;
        };
      }
  )[];
  tool_choice?:
    | string
    | { type: "function"; function: { name: string } }
    | { type: "custom"; custom: { name: string } }
    | {
        type: "allowed_tools";
        allowed_tools: {
          mode: "auto" | "required";
          tools: Record<string, any>[];
        };
      };
  parallel_tool_calls?: boolean;
  user?: string;
  verbosity?: "low" | "medium" | "high" | null;
  web_search_options?: Record<string, any>;
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
