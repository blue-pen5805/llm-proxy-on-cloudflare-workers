// --- Messages ---
// https://docs.anthropic.com/en/api/messages
export type AnthropicCreateMessageRequestBody = {
  model: string;
  messages: {
    role: "user" | "assistant";
    content: string | AnthropicContent[];
  }[];
  max_tokens: number;
  metadata?: {
    user_id: string | null;
  };
  stop_sequences?: string[];
  stream?: boolean;
  system?:
    | string
    | {
        type: "text";
        text: string;
        cache_control?: {
          type: "ephemeral";
        } | null;
      };
  temperature?: number;
  tool_choice?:
    | {
        type: "auto";
        disable_parallel_tool_use?: boolean;
      }
    | {
        type: "any";
        disable_parallel_tool_use?: boolean;
      }
    | {
        type: "tool";
        disable_parallel_tool_use?: boolean;
        name: string;
      };
  tools?: (
    | {
        type?: "custom" | null;
        description?: string;
        name: string;
        input_schema: {
          type: "object";
          properties?: Record<string, any> | null;
        };
        cache_control: {
          type: "ephemeral";
        };
      }
    | {
        cache_control?: {
          type: "ephemeral";
        } | null;
        type: "computer_20241022";
        name: "computer";
        display_height_px: number;
        display_width_px: number;
        display_number?: number | null;
      }
    | {
        cache_control?: {
          type: "ephemeral";
        } | null;
        type: "bash_20241022";
        name: "bash";
      }
    | {
        cache_control?: {
          type: "ephemeral";
        } | null;
        type: "text_editor_20241022";
        name: "str_replace_editor";
      }
  )[];
  top_k?: number;
  top_p?: number;
};

// Content
export type AnthropicContent =
  | AnthropicTextContent
  | AnthropicImageContent
  | AnthropicToolUseContent
  | AnthropicToolResultContent
  | AnthropicDocumentContent;

export type AnthropicTextContent = {
  type: "text";
  text: string;
};
export type AnthropicImageContent = {
  type: "image";
  source: {
    type: "base64";
    media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
    data: string;
  };
  cache_control?: {
    type: "ephemeral";
  } | null;
};
export type AnthropicToolUseContent = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, any>;
  cache_control?: {
    type: "ephemeral";
  } | null;
};
export type AnthropicToolResultContent = {
  type: "tool-result";
  tool_use_id: string;
  is_error: boolean;
  content: string | AnthropicTextContent | AnthropicImageContent;
  cache_control?: {
    type: "ephemeral";
  } | null;
};
export type AnthropicDocumentContent = {
  type: "document";
  source: {
    type: "base64";
    media_type: "application/pdf";
    data: string;
  };
  cache_control?: {
    type: "ephemeral";
  } | null;
};

// Response
export type AnthropicCreateMessageResponseBody = {
  id: string;
  type: "message";
  role: "assistant";
  content: (AnthropicTextContent | AnthropicToolUseContent)[];
  model: string;
  stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | null;
  usage: {
    input_tokens: number;
    cache_creation_input_tokens: number | null;
    cache_read_input_tokens: number | null;
    output_tokens: number;
  };
};

// https://docs.anthropic.com/en/api/messages-streaming
export type AnthropicCreateMessageChunkResponseBody =
  | AnthropicV2CreateMessageChunkMessageStart
  | AnthropicV2CreateMessageChunkMessageDelta
  | AnthropicV2CreateMessageChunkMessageStop
  | AnthropicV2CreateMessageChunkContentBlockStart
  | AnthropicV2CreateMessageChunkContentBlockDelta
  | AnthropicV2CreateMessageChunkContentBlockstop
  | AnthropicV2CreateMessageChunkError
  | AnthropicV2CreateMessageChunkPing;

type AnthropicV2CreateMessageChunkMessageStart = {
  type: "message_start";
  message: AnthropicCreateMessageResponseBody;
};

type AnthropicV2CreateMessageChunkMessageDelta = {
  type: "message_delta";
  delta: Partial<AnthropicCreateMessageResponseBody>;
  usage: AnthropicCreateMessageResponseBody["usage"];
};

type AnthropicV2CreateMessageChunkMessageStop = {
  type: "message_stop";
};

type AnthropicV2CreateMessageChunkContentBlockStart = {
  type: "content_block_start";
  index: number;
  content_block: AnthropicTextContent | AnthropicToolUseContent;
};

type AnthropicV2CreateMessageChunkContentBlockDelta = {
  type: "content_block_delta";
  index: number;
  delta:
    | {
        type: "text_delta";
        text: string;
      }
    | {
        type: "input_json_delta";
        partial_json: string;
      };
};

type AnthropicV2CreateMessageChunkContentBlockstop = {
  type: "content_block_stop";
  index: number;
};

type AnthropicV2CreateMessageChunkError = {
  type: "error";
  error: {
    type: string;
    message: string;
  };
};

type AnthropicV2CreateMessageChunkPing = {
  type: "ping";
};

// -- Models --
export type AnthropicModelsListResponseBody = {
  data: {
    type: string;
    id: string;
    display_name: string;
    created_at: string;
  }[];
  has_more: boolean;
  first_id: string;
  last_id: string;
};
