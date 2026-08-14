import type { JsonObject } from "../sse";

export interface MessagesCacheControl extends JsonObject {
  type: "ephemeral";
  ttl?: "5m" | "1h";
}

export interface MessagesTextBlock extends JsonObject {
  type: "text";
  text: string;
  cache_control?: MessagesCacheControl;
  citations?: unknown;
}

export interface MessagesImageSource extends JsonObject {
  type: "base64" | "url" | string;
  media_type?: string;
  data?: string;
  url?: string;
}

export interface MessagesImageBlock extends JsonObject {
  type: "image";
  source: MessagesImageSource;
  cache_control?: MessagesCacheControl;
}

export interface MessagesToolUseBlock extends JsonObject {
  type: "tool_use";
  id: string;
  name: string;
  input: JsonObject;
  cache_control?: MessagesCacheControl;
}

export interface MessagesToolResultBlock extends JsonObject {
  type: "tool_result";
  tool_use_id: string;
  content?: string | MessagesContentBlock[];
  is_error?: boolean;
  cache_control?: MessagesCacheControl;
}

/** Compatibility extension accepted by the proxy for mid-conversation system text. */
export interface MessagesMidConversationSystemBlock extends JsonObject {
  type: "mid_conv_system";
  content: MessagesTextBlock[];
  cache_control?: MessagesCacheControl;
}

export interface MessagesExtensionContentBlock extends JsonObject {
  type: string;
}

export type MessagesContentBlock =
  | MessagesTextBlock
  | MessagesImageBlock
  | MessagesToolUseBlock
  | MessagesToolResultBlock
  | MessagesMidConversationSystemBlock
  | MessagesExtensionContentBlock;

export interface MessagesMessageParam extends JsonObject {
  // `system` is a proxy compatibility extension; the provider-native API uses
  // the top-level system field.
  role: "user" | "assistant" | "system" | string;
  content: string | MessagesContentBlock[];
}

export interface MessagesTool extends JsonObject {
  name: string;
  input_schema: JsonObject;
  description?: string;
  strict?: boolean;
  type?: "custom" | string | null;
  cache_control?: MessagesCacheControl;
}

export interface MessagesToolChoice extends JsonObject {
  type: "auto" | "any" | "tool" | "none" | string;
  name?: string;
  disable_parallel_tool_use?: boolean;
}

export interface MessagesOutputFormat extends JsonObject {
  type: "json_schema" | string;
  schema?: JsonObject;
}

export interface MessagesOutputConfig extends JsonObject {
  effort?: string;
  format?: MessagesOutputFormat | null;
}

export interface MessagesMetadata extends JsonObject {
  user_id?: string | null;
}

/** Request fields accepted by the Messages compatibility endpoint. */
export interface MessagesRequest {
  max_tokens: number;
  messages: MessagesMessageParam[];
  model: string;
  metadata?: MessagesMetadata;
  output_config?: MessagesOutputConfig;
  stop_sequences?: string[];
  stream?: boolean;
  system?: string | MessagesTextBlock[];
  temperature?: number;
  tool_choice?: MessagesToolChoice;
  tools?: MessagesTool[];
  top_p?: number;

  // Known fields without a Chat Completions conversion are accepted and ignored.
  cache_control?: unknown;
  container?: unknown;
  context_management?: unknown;
  inference_geo?: unknown;
  mcp_servers?: unknown;
  service_tier?: unknown;
  thinking?: unknown;
  top_k?: unknown;
  user_profile_id?: unknown;
}
